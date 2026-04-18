"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getIsAdmin, requireAdmin } from "@/lib/is-admin";
import { computeSimulationRpInstant, type SimulationSettingsRow } from "@/lib/simulation-calendar";
import { resolveSimulationSettingsForWidget } from "@/lib/simulation-widget-data";

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

export async function updateSimulationSettings(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const real_anchor_at = String(formData.get("real_anchor_at") ?? "").trim();
  const rp_anchor_date = String(formData.get("rp_anchor_date") ?? "").trim();
  const rp_months_raw = String(formData.get("rp_months_per_real_day") ?? "").trim();
  const admin_off_raw = String(formData.get("admin_rp_month_offset") ?? "").trim();
  const auto_open = String(formData.get("auto_open_filings_in_rp_january") ?? "").trim() === "on";

  if (!real_anchor_at || !rp_anchor_date) throw new Error("Anchor date and real anchor time are required.");
  const d = new Date(real_anchor_at);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid real anchor time.");
  const rp_months_per_real_day = Number(rp_months_raw);
  if (!Number.isFinite(rp_months_per_real_day) || rp_months_per_real_day <= 0 || rp_months_per_real_day > 366) {
    throw new Error("RP months per real day must be a positive number (max 366).");
  }
  const admin_rp_month_offset = admin_off_raw === "" ? 0 : Number(admin_off_raw);
  if (!Number.isFinite(admin_rp_month_offset)) throw new Error("Admin month offset must be a number.");

  const { error } = await supabase
    .from("simulation_settings")
    .update({
      real_anchor_at: d.toISOString(),
      rp_anchor_date,
      rp_months_per_real_day,
      admin_rp_month_offset,
      auto_open_filings_in_rp_january: auto_open,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) throw new Error(error.message);
  revalidatePath("/admin/elections");
  revalidatePath("/elections");
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
  if (error) throw new Error(error.message);
  revalidatePath("/admin/elections");
  revalidatePath("/elections");
}

export type OpenSeatFilingsResult = { opened: number; skipped: number };

async function bulkOpenDormantOccupiedSeatFilings(supabase: SupabaseClient): Promise<OpenSeatFilingsResult> {
  const { data: dormant, error } = await supabase
    .from("elections")
    .select("id, office, state, district_code, senate_class, filing_window_started_at, phase, leadership_role")
    .eq("phase", "filing")
    .is("filing_window_started_at", null)
    .is("leadership_role", null)
    .in("office", ["house", "senate", "president"]);

  if (error) throw new Error(error.message);
  const rows = dormant ?? [];
  let opened = 0;
  let skipped = 0;

  const { count: totalPlayers, error: pcErr } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (pcErr) throw new Error(pcErr.message);
  const playerTotal = totalPlayers ?? 0;

  for (const e of rows) {
    const office = e.office as string;
    let occupied = false;
    if (office === "president") {
      occupied = playerTotal >= 1;
    } else if (office === "house") {
      const code = String(e.district_code ?? "").trim();
      if (!code) {
        skipped += 1;
        continue;
      }
      const { count, error: cErr } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("home_district_code", code.trim().toUpperCase());
      if (cErr) throw new Error(cErr.message);
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
      if (cErr) throw new Error(cErr.message);
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

    if (uErr) throw new Error(uErr.message);
    opened += 1;
  }

  return { opened, skipped };
}

/**
 * Opens filing windows for dormant seat races that have at least one player in jurisdiction.
 * Does not touch races that already have filing_window_started_at set.
 * Vacates sitting House representatives in opened districts and the last closed Senate winner for that class (if any).
 */
export async function openOccupiedSeatElectionFilings(): Promise<OpenSeatFilingsResult> {
  const { supabase } = await requireAdmin();
  const result = await bulkOpenDormantOccupiedSeatFilings(supabase);
  revalidatePath("/admin/elections");
  revalidatePath("/elections");
  return result;
}

/**
 * Admin: open filings for one seat election (even if empty), with optional vacate of incumbents.
 */
export async function openSeatElectionFiling(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("election_id") ?? "").trim();
  if (!id) throw new Error("Missing election id.");

  const { data: e, error } = await supabase
    .from("elections")
    .select("id, office, state, district_code, senate_class, phase, leadership_role, filing_window_started_at")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
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

  if (uErr) throw new Error(uErr.message);
  revalidatePath("/admin/elections");
  revalidatePath(`/admin/elections/${id}`);
  revalidatePath("/elections");
  revalidatePath(`/elections/${id}`);
}

/**
 * When an admin visits the elections console during RP January, optionally runs the same
 * bulk-open as the manual button once per RP calendar month-key (stops repeat work on refresh).
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

  await bulkOpenDormantOccupiedSeatFilings(supabase);

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
