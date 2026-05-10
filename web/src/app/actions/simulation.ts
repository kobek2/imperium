"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getIsAdmin, requireAdmin } from "@/lib/is-admin";
import { computeSimulationRpInstant, type SimulationSettingsRow } from "@/lib/simulation-calendar";
import { resolveSimulationSettingsForWidget } from "@/lib/simulation-widget-data";
import { throwIfPostgrestError } from "@/lib/supabase-error";
import { tickCalendarEvents } from "@/lib/calendar-event-engine";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";

const MS_PER_HOUR = 60 * 60 * 1000;
const FILING_HOURS = 24;
const PRIMARY_HOURS = 24;
const GENERAL_HOURS = 24;

function scheduleFromNow(): {
  filing_opens_at: string;
  filing_closes_at: string;
  primary_closes_at: string;
  general_closes_at: string;
} {
  const t0 = Date.now();
  const filing_opens_at = new Date(t0).toISOString();
  const filing_closes_at = new Date(t0 + FILING_HOURS * MS_PER_HOUR).toISOString();
  const primary_closes_at = new Date(t0 + (FILING_HOURS + PRIMARY_HOURS) * MS_PER_HOUR).toISOString();
  const general_closes_at = new Date(
    t0 + (FILING_HOURS + PRIMARY_HOURS + GENERAL_HOURS) * MS_PER_HOUR,
  ).toISOString();
  return { filing_opens_at, filing_closes_at, primary_closes_at, general_closes_at };
}

async function revokeChamberRoleForUsers(
  supabase: SupabaseClient,
  userIds: string[],
  roleKey: "representative" | "senator",
) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  await supabase.from("government_role_grants").delete().in("user_id", ids).eq("role_key", roleKey);
  await supabase
    .from("profiles")
    .update({ office_role: null, updated_at: new Date().toISOString() })
    .in("id", ids)
    .eq("office_role", roleKey);
}

async function vacateHouseIncumbentForDistrict(supabase: SupabaseClient, districtCode: string) {
  const d = districtCode.trim().toUpperCase();
  if (!d) return;
  const { data: rows } = await supabase.from("profiles").select("id").eq("home_district_code", d);
  const ids = (rows ?? []).map((r) => r.id as string);
  if (!ids.length) return;
  await revokeChamberRoleForUsers(supabase, ids, "representative");
}

async function vacateSenateLastWinnerForSeat(
  supabase: SupabaseClient,
  state: string,
  senateClass: number,
  currentElectionId: string,
) {
  const st = state.trim().toUpperCase();
  const { data: prior } = await supabase
    .from("elections")
    .select("winner_user_id")
    .eq("office", "senate")
    .eq("state", st)
    .eq("senate_class", senateClass)
    .eq("phase", "closed")
    .not("winner_user_id", "is", null)
    .neq("id", currentElectionId)
    .order("general_closes_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const uid = prior?.winner_user_id as string | undefined;
  if (!uid) return;
  await revokeChamberRoleForUsers(supabase, [uid], "senator");
}

/** Legacy onboarding / January automation only (pace and RP anchor are no longer editable here). */
export async function updateSimulationSettings(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const auto_open = String(formData.get("auto_open_filings_in_rp_january") ?? "").trim() === "on";
  const auto_seat =
    String(formData.get("auto_create_seat_elections_on_onboarding") ?? "").trim() === "on";

  const { error } = await supabase
    .from("simulation_settings")
    .update({
      auto_open_filings_in_rp_january: auto_open,
      auto_create_seat_elections_on_onboarding: auto_seat,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  throwIfPostgrestError(error);
  revalidatePath("/admin/elections");
  revalidatePath("/elections");
}

export async function updateSimulationStartAt(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const raw = String(formData.get("simulation_start_at") ?? "").trim();
  const confirm = String(formData.get("confirm_simulation_start") ?? "").trim() === "1";

  if (!raw) throw new Error("simulation_start_at is required.");
  if (!confirm) throw new Error("Confirm before setting the simulation start time.");

  const start = new Date(raw);
  if (Number.isNaN(start.getTime())) throw new Error("Invalid simulation_start_at.");

  const { data: row } = await supabase.from("simulation_settings").select("simulation_start_at, simulation_start_unlocked").eq("id", 1).maybeSingle();
  const existing = row as { simulation_start_at?: string | null; simulation_start_unlocked?: boolean | null } | null;
  if (existing?.simulation_start_at && !existing?.simulation_start_unlocked) {
    throw new Error("simulation_start_at is locked after first save. Ask a super-admin to unlock.");
  }

  const { error } = await supabase
    .from("simulation_settings")
    .update({
      simulation_start_at: start.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  throwIfPostgrestError(error);
  revalidatePath("/admin/elections");
}

export async function setCalendarIsActive(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const on = String(formData.get("calendar_is_active") ?? "").trim() === "on";
  const confirm = String(formData.get("confirm_calendar_activate") ?? "").trim() === "1";
  if (on && !confirm) {
    throw new Error("Confirm before activating the automated calendar.");
  }

  const { data: row } = await supabase.from("simulation_settings").select("simulation_start_at").eq("id", 1).maybeSingle();
  if (on && !(row as { simulation_start_at?: string | null } | null)?.simulation_start_at) {
    throw new Error("Set simulation_start_at before activating the calendar.");
  }

  const { error } = await supabase
    .from("simulation_settings")
    .update({
      calendar_is_active: on,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  throwIfPostgrestError(error);
  revalidatePath("/admin/elections");

  const svc = createServiceRoleSupabase();
  if (svc) await tickCalendarEvents(svc);
}

/**
 * Narrative / season reset: clears calendar milestone dedupe, sets `simulation_start_at` to now so RP reads as
 * January 2029 at the fixed v2 pace, turns the automated calendar on, and runs one tick (inauguration and other due
 * handlers). Requires `SUPABASE_SERVICE_ROLE_KEY` so calendar rows can be cleared and the start time can be rewritten
 * even when the normal admin form lock is on.
 */
export async function resetCalendarV2ToJanuary2029AndActivate(formData: FormData): Promise<void> {
  await requireAdmin();
  const confirm = String(formData.get("confirm_rp_calendar_reset") ?? "").trim() === "1";
  if (!confirm) {
    throw new Error("Confirm the hard reset before continuing.");
  }

  const svc = createServiceRoleSupabase();
  if (!svc) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured on the server; this reset requires the service role client.",
    );
  }

  const nowIso = new Date().toISOString();

  const { error: delErr } = await svc
    .from("simulation_calendar_events")
    .delete()
    .in("status", ["success", "error"]);
  throwIfPostgrestError(delErr);

  const { error: updErr } = await svc
    .from("simulation_settings")
    .update({
      simulation_start_at: nowIso,
      calendar_is_active: true,
      last_auto_open_rp_key: null,
      updated_at: nowIso,
    })
    .eq("id", 1);
  throwIfPostgrestError(updErr);

  await tickCalendarEvents(svc);

  revalidatePath("/admin/elections");
  revalidatePath("/admin/operations");
  revalidatePath("/economy");
  revalidatePath("/elections");
  revalidatePath("/congress");
  revalidatePath("/");
}

export async function manualFireCalendarEvent(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAdmin();
  const eventKey = String(formData.get("event_key") ?? "").trim();
  if (!eventKey) throw new Error("Missing event_key.");

  const { error } = await supabase.from("simulation_calendar_events").insert({
    event_key: `manual_audit_${Date.now()}`,
    status: "success",
    error_message: null,
    metadata: { target_event: eventKey, manually_triggered: true, triggered_by: user.id },
  });
  throwIfPostgrestError(error);
  revalidatePath("/admin/elections");
}

export async function adminUnfreezeEconomy(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const confirm = String(formData.get("confirm_unfreeze") ?? "").trim() === "1";
  if (!confirm) throw new Error("Confirmation required.");

  const { data, error } = await supabase.rpc("simulation_admin_unfreeze_economy", { p_confirm: true });
  if (error) throw new Error(error.message);
  void data;
  revalidatePath("/economy");
  revalidatePath("/admin/elections");
}

export async function unlockSimulationStartForSuperAdmin(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const on = String(formData.get("simulation_start_unlocked") ?? "").trim() === "on";
  const { error } = await supabase
    .from("simulation_settings")
    .update({ simulation_start_unlocked: on, updated_at: new Date().toISOString() })
    .eq("id", 1);
  throwIfPostgrestError(error);
  revalidatePath("/admin/elections");
}

/**
 * Sets `real_anchor_at` to the current server time. Use this after changing the RP anchor date
 * so “right now” in real life lines up with that RP date (otherwise RP races ahead by months per
 * real day between the old anchor and today).
 */
export async function syncSimulationRealAnchorToNow(): Promise<void> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("simulation_settings")
    .update({
      real_anchor_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  throwIfPostgrestError(error);
  revalidatePath("/admin/elections");
  revalidatePath("/elections");
}

export type OpenSeatFilingsResult = { opened: number; skipped: number; created: number };

/**
 * Inserts dormant filing templates for House districts and Senate seats that have at least one
 * resident profile but no active (non-closed) seat race yet — so bulk-open can run a full
 * re-election cycle without hand-creating every row.
 */
async function ensureDormantCongressionalSeatTemplatesForResidents(supabase: SupabaseClient): Promise<number> {
  const sched = scheduleFromNow();

  const [{ data: profs, error: pErr }, { data: activeHouse, error: ahErr }] = await Promise.all([
    supabase.from("profiles").select("home_district_code, residence_state"),
    supabase
      .from("elections")
      .select("district_code")
      .eq("office", "house")
      .is("leadership_role", null)
      .neq("phase", "closed"),
  ]);
  throwIfPostgrestError(pErr);
  throwIfPostgrestError(ahErr);

  const activeHouseDistricts = new Set(
    (activeHouse ?? [])
      .map((r) => String((r as { district_code: string | null }).district_code ?? "").trim().toUpperCase())
      .filter(Boolean),
  );

  const houseDistricts = new Set<string>();
  const residenceStates = new Set<string>();
  for (const p of profs ?? []) {
    const hd = String((p as { home_district_code?: string | null }).home_district_code ?? "")
      .trim()
      .toUpperCase();
    if (hd) houseDistricts.add(hd);
    const st = String((p as { residence_state?: string | null }).residence_state ?? "")
      .trim()
      .toUpperCase();
    if (st.length === 2) residenceStates.add(st);
  }

  let created = 0;

  const districtList = [...houseDistricts];
  if (districtList.length) {
    const byCode = new Map<string, string>();
    const chunkSize = 100;
    for (let i = 0; i < districtList.length; i += chunkSize) {
      const chunk = districtList.slice(i, i + chunkSize);
      const { data: drows, error: dErr } = await supabase.from("districts").select("code, state").in("code", chunk);
      throwIfPostgrestError(dErr);
      for (const row of drows ?? []) {
        const code = String((row as { code: string }).code).trim().toUpperCase();
        const state = String((row as { state: string }).state).trim().toUpperCase();
        if (code && state) byCode.set(code, state);
      }
    }

    const houseInserts: Record<string, unknown>[] = [];
    for (const [code, state] of byCode) {
      if (activeHouseDistricts.has(code)) continue;
      houseInserts.push({
        office: "house",
        state,
        district_code: code,
        senate_class: null,
        phase: "filing",
        ...sched,
        primary_party_wide: true,
        filing_window_started_at: null,
      });
      activeHouseDistricts.add(code);
    }
    if (houseInserts.length) {
      const { error: insErr } = await supabase.from("elections").insert(houseInserts);
      throwIfPostgrestError(insErr);
      created += houseInserts.length;
    }
  }

  const { data: activeSenate, error: asErr } = await supabase
    .from("elections")
    .select("state, senate_class")
    .eq("office", "senate")
    .is("leadership_role", null)
    .neq("phase", "closed");
  throwIfPostgrestError(asErr);

  const activeSenateKeys = new Set(
    (activeSenate ?? []).map((r) => {
      const st = String((r as { state: string | null }).state ?? "").trim().toUpperCase();
      const sc = (r as { senate_class: number | null }).senate_class;
      return `${st}:${sc ?? ""}`;
    }),
  );

  if (residenceStates.size) {
    const senateInserts: Record<string, unknown>[] = [];
    for (const S of residenceStates) {
      for (const sc of [1, 2, 3] as const) {
        const key = `${S}:${sc}`;
        if (activeSenateKeys.has(key)) continue;
        senateInserts.push({
          office: "senate",
          state: S,
          district_code: null,
          senate_class: sc,
          phase: "filing",
          ...sched,
          primary_party_wide: true,
          filing_window_started_at: null,
        });
        activeSenateKeys.add(key);
      }
    }
    if (senateInserts.length) {
      const { error: insErr } = await supabase.from("elections").insert(senateInserts);
      throwIfPostgrestError(insErr);
      created += senateInserts.length;
    }
  }

  return created;
}

/**
 * Opens dormant House and Senate seat races where at least one profile lives in that district or state
 * (re-election / incumbent geography). Does not include President — use the presidential race admin flow.
 */
async function bulkOpenDormantCongressionalSeatFilings(supabase: SupabaseClient): Promise<OpenSeatFilingsResult> {
  const { data: dormant, error } = await supabase
    .from("elections")
    .select("id, office, state, district_code, senate_class, filing_window_started_at, phase, leadership_role")
    .eq("phase", "filing")
    .is("filing_window_started_at", null)
    .is("leadership_role", null)
    .in("office", ["house", "senate"]);

  throwIfPostgrestError(error);
  const rows = dormant ?? [];
  let opened = 0;
  let skipped = 0;

  for (const e of rows) {
    const office = e.office as string;

    let occupied = false;
    if (office === "house") {
      const code = String(e.district_code ?? "").trim();
      if (!code) {
        skipped += 1;
        continue;
      }
      const { count, error: cErr } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("home_district_code", code.trim().toUpperCase());
      throwIfPostgrestError(cErr);
      occupied = (count ?? 0) >= 1;
    } else if (office === "senate") {
      const st = String(e.state ?? "").trim().toUpperCase();
      if (!st || st.length !== 2) {
        skipped += 1;
        continue;
      }
      const { count, error: cErr } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("residence_state", st);
      throwIfPostgrestError(cErr);
      occupied = (count ?? 0) >= 1;
    } else {
      skipped += 1;
      continue;
    }

    if (!occupied) {
      skipped += 1;
      continue;
    }

    const sched = scheduleFromNow();
    if (office === "house" && e.district_code) {
      await vacateHouseIncumbentForDistrict(supabase, e.district_code as string);
    } else if (office === "senate" && e.state && e.senate_class != null) {
      await vacateSenateLastWinnerForSeat(
        supabase,
        e.state as string,
        Number(e.senate_class),
        e.id as string,
      );
    }

    const { error: uErr } = await supabase
      .from("elections")
      .update({
        ...sched,
        phase: "filing",
        filing_window_started_at: sched.filing_opens_at,
      })
      .eq("id", e.id)
      .is("filing_window_started_at", null);

    throwIfPostgrestError(uErr);
    opened += 1;
  }

  return { opened, skipped, created: 0 };
}

/**
 * Ensures a dormant seat row exists for every occupied jurisdiction, then opens each dormant House/Senate
 * race where at least one profile lists that district (House) or state (Senate) — for re-election cycles.
 * Skips races already live. Does not include President. Vacates House reps in opened districts and the
 * prior Senate class winner when applicable.
 */
export async function startAllCongressionalElectionFilings(): Promise<OpenSeatFilingsResult> {
  const { supabase } = await requireAdmin();
  const created = await ensureDormantCongressionalSeatTemplatesForResidents(supabase);
  const { opened, skipped } = await bulkOpenDormantCongressionalSeatFilings(supabase);
  revalidatePath("/admin/elections");
  revalidatePath("/elections");
  return { opened, skipped, created };
}

/** @deprecated Prefer startAllCongressionalElectionFilings */
export const startAllEligibleDormantElectionFilings = startAllCongressionalElectionFilings;
/** @deprecated Prefer startAllCongressionalElectionFilings */
export const openOccupiedSeatElectionFilings = startAllCongressionalElectionFilings;

/** Core open-dormant logic (admin RLS). */
async function openOneDormantSeatElection(supabase: SupabaseClient, id: string): Promise<void> {
  const { data: e, error } = await supabase
    .from("elections")
    .select("id, office, state, district_code, senate_class, phase, leadership_role, filing_window_started_at")
    .eq("id", id)
    .maybeSingle();

  throwIfPostgrestError(error);
  if (!e) throw new Error("Election not found.");
  if (e.leadership_role) throw new Error("Use the leadership tools for leadership races.");
  if (e.phase !== "filing") throw new Error("Only races in filing phase can use dormant filing windows.");
  if (e.filing_window_started_at) throw new Error("This race’s filing window is already open.");

  const office = e.office as string;
  const sched = scheduleFromNow();

  if (office === "house" && e.district_code) {
    await vacateHouseIncumbentForDistrict(supabase, e.district_code as string);
  } else if (office === "senate" && e.state != null && e.senate_class != null) {
    await vacateSenateLastWinnerForSeat(supabase, e.state as string, Number(e.senate_class), e.id as string);
  }

  const { error: uErr } = await supabase
    .from("elections")
    .update({
      ...sched,
      phase: "filing",
      filing_window_started_at: sched.filing_opens_at,
    })
    .eq("id", id);

  throwIfPostgrestError(uErr);
}

/**
 * Admin: open filings for one seat election (even if empty), with optional vacate of incumbents.
 */
export async function openSeatElectionFiling(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("election_id") ?? "").trim();
  if (!id) throw new Error("Missing election id.");

  await openOneDormantSeatElection(supabase, id);
  revalidatePath("/admin/elections");
  revalidatePath(`/admin/elections/${id}`);
  revalidatePath("/elections");
  revalidatePath(`/elections/${id}`);
}

/**
 * Admin: open dormant filings for many seat races at once (same rules as opening one).
 */
export async function openSelectedSeatElectionFilings(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const raw = formData.getAll("election_id");
  const ids = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
  if (!ids.length) throw new Error("Select at least one dormant race to open.");

  const errors: string[] = [];
  for (const id of ids.sort((a, b) => a.localeCompare(b))) {
    try {
      await openOneDormantSeatElection(supabase, id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${id.slice(0, 8)}…: ${msg}`);
    }
  }

  if (errors.length) {
    throw new Error(`${errors.length} race(s) failed. ${errors.slice(0, 6).join("; ")}`);
  }

  revalidatePath("/admin/elections");
  revalidatePath("/elections");
  for (const id of ids) {
    revalidatePath(`/admin/elections/${id}`);
    revalidatePath(`/elections/${id}`);
  }
}

/**
 * When an admin visits the elections console during RP January, optionally runs the same
 * congressional bulk-open as “Start all congressional elections” once per RP calendar month-key.
 */
export async function runJanuaryAutoOpenIfEligible(): Promise<void> {
  if (!(await getIsAdmin())) return;
  const { supabase } = await requireAdmin();
  const { data: settings, error } = await supabase
    .from("simulation_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error || !settings) return;
  const s = settings as SimulationSettingsRow;
  if (!s.auto_open_filings_in_rp_january) return;
  const effective = await resolveSimulationSettingsForWidget(supabase, s, true);
  const rp = computeSimulationRpInstant(effective, new Date());
  if (rp.month !== 1) return;
  if (s.last_auto_open_rp_key === rp.yearMonthKey) return;

  await ensureDormantCongressionalSeatTemplatesForResidents(supabase);
  await bulkOpenDormantCongressionalSeatFilings(supabase);

  await supabase
    .from("simulation_settings")
    .update({
      last_auto_open_rp_key: rp.yearMonthKey,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  revalidatePath("/admin/elections");
  revalidatePath("/elections");
}
