import type { SupabaseClient } from "@supabase/supabase-js";
import { CALENDAR_LEADERSHIP_WINDOW_HOURS } from "@/lib/simulation-us-election-calendar";
import {
  leadershipRaceScheduleFromNow,
  processSeatElectionCalendarSeating,
  seatRaceScheduleFromNow,
  type SeatElectionRow,
  type SeatRaceSchedule,
} from "@/lib/calendar-seating-helpers";
import {
  calendarSuccessExists,
  insertCalendarEventError,
  insertCalendarEventSuccess,
} from "@/lib/calendar-event-log";
import type { SimulationSettingsRow } from "@/lib/simulation-calendar";
import { isoSimulationStartForRpInstantAt } from "@/lib/simulation-calendar-constants";
import type { Chamber } from "@/lib/leadership";
import { inferMajorityParty } from "@/lib/leadership-majority";

/** Congressional leadership keys in government_role_grants (see congress-composition + legislation deputy rotation). */
const CONGRESSIONAL_LEADERSHIP_GRANT_KEYS = [
  "speaker",
  "house_deputy",
  "house_majority_leader",
  "house_majority_whip",
  "house_minority_leader",
  "house_minority_whip",
  "president_pro_tempore",
  "senate_deputy",
  "senate_majority_leader",
  "senate_majority_whip",
  "senate_minority_leader",
  "senate_minority_whip",
] as const;

/**
 * Clears prior-term congressional leadership so a new Congress is not stuck with old Speakers / whips / PPT.
 * Closes Hopper leadership_sessions and abandons stale Speaker / SML election rows that block
 * openChamberLeadershipSessionsIfNone. Re-runs deputy rotation from economy collects.
 */
async function resetCongressionalLeadershipForNewTerm(
  supabase: SupabaseClient,
  _simStartIso: string | null,
): Promise<void> {
  void _simStartIso;
  const keys = [...CONGRESSIONAL_LEADERSHIP_GRANT_KEYS];

  const { error: delErr } = await supabase.from("government_role_grants").delete().in("role_key", keys);
  if (delErr) console.warn("[calendar] clear leadership grants:", delErr.message);

  const { error: profErr } = await supabase
    .from("profiles")
    .update({ office_role: null, updated_at: new Date().toISOString() })
    .in("office_role", keys);
  if (profErr) console.warn("[calendar] clear leadership office_role:", profErr.message);

  const { error: sessErr } = await supabase
    .from("leadership_sessions")
    .update({ phase: "closed", closed_at: new Date().toISOString() })
    .eq("phase", "open");
  if (sessErr) console.warn("[calendar] close leadership_sessions:", sessErr.message);

  const { error: abErr } = await supabase
    .from("elections")
    .update({ phase: "closed" })
    .not("leadership_role", "is", null)
    .in("phase", ["filing", "primary", "general"]);
  if (abErr) console.warn("[calendar] abandon stale leadership elections:", abErr.message);

  const { error: dcErr } = await supabase.rpc("legislation_run_maintenance");
  if (dcErr) console.warn("[calendar] legislation_run_maintenance:", dcErr.message);
}

async function loadSimulationSettings(supabase: SupabaseClient): Promise<SimulationSettingsRow | null> {
  const { data, error } = await supabase.from("simulation_settings").select("*").eq("id", 1).maybeSingle();
  if (error || !data) return null;
  return data as SimulationSettingsRow;
}

/** Seat races for a January inauguration: House + Senate classes 1 & 3 + President, excluding calendar midterm/presidential-cycle rows. */
async function seatInaugurationCalendarElections(
  supabase: SupabaseClient,
  simStartIso: string | null,
): Promise<number> {
  const { data: rows, error } = await supabase
    .from("elections")
    .select("id, office, state, district_code, senate_class, winner_user_id, calendar_cycle_key, general_closes_at")
    .eq("phase", "closed")
    .is("leadership_role", null)
    .is("calendar_seated_at", null);

  if (error || !rows?.length) return 0;

  const simStartMs = simStartIso ? new Date(simStartIso).getTime() : null;

  const toSeat = rows.filter((raw) => {
    const row = raw as {
      office: string;
      senate_class: number | null;
      calendar_cycle_key: string | null;
      general_closes_at: string | null;
      winner_user_id: string | null;
    };
    if (!row.winner_user_id) return false;
    if (row.office === "house") {
      /* ok */
    } else if (row.office === "president") {
      /* ok */
    } else if (row.office === "senate") {
      const c = row.senate_class;
      if (c !== 1 && c !== 3) return false;
    } else {
      return false;
    }

    const ck = row.calendar_cycle_key ?? "";
    if (ck.startsWith("midterms_") || ck.startsWith("presidential_")) return false;

    if (simStartMs != null && Number.isFinite(simStartMs) && !row.calendar_cycle_key) {
      const g = row.general_closes_at ? new Date(row.general_closes_at).getTime() : NaN;
      if (Number.isFinite(g) && g < simStartMs) return false;
    }

    return true;
  });

  for (const raw of toSeat) {
    await processSeatElectionCalendarSeating(supabase, raw as SeatElectionRow);
  }
  return toSeat.length;
}

/**
 * Opens one `leadership_sessions` row per chamber when none are open: same combined window as
 * the old Speaker/SML `elections` leadership rows (filing through general_closes_at).
 * Members file for one role and vote on all roles (Speaker, PPT, majority/minority leaders, whips).
 */
function isLeadershipSessionOpenConflict(error: { code?: string; message?: string } | null): boolean {
  const msg = (error?.message ?? "").toLowerCase();
  return (
    error?.code === "23505" ||
    msg.includes("duplicate key") ||
    msg.includes("unique constraint") ||
    msg.includes("leadership_sessions_one_open_per_chamber")
  );
}

async function openChamberLeadershipSessionsIfNone(supabase: SupabaseClient): Promise<void> {
  const sched = leadershipRaceScheduleFromNow();
  const closesAt = sched.general_closes_at;
  const errors: string[] = [];

  const chambers: Chamber[] = ["house", "senate"];
  for (const chamber of chambers) {
    const { data: existingOpen, error: exErr } = await supabase
      .from("leadership_sessions")
      .select("id")
      .eq("chamber", chamber)
      .eq("phase", "open")
      .maybeSingle();
    if (exErr) {
      errors.push(`${chamber} leadership session (lookup): ${exErr.message}`);
      continue;
    }
    if (existingOpen) continue;

    const majorityParty = await inferMajorityParty(supabase, chamber);
    const { error } = await supabase.from("leadership_sessions").insert({
      chamber,
      phase: "open",
      majority_party: majorityParty,
      closes_at: closesAt,
    });
    if (error) {
      // Another tick or admin may have opened this chamber between lookup and insert; index still enforces one open row.
      if (isLeadershipSessionOpenConflict(error)) continue;
      errors.push(`${chamber} leadership session: ${error.message}`);
    }
  }

  if (errors.length) {
    throw new Error(`[calendar] Could not open chamber leadership sessions: ${errors.join(" · ")}`);
  }
}

async function rpcOpenPartyLeadershipWindows(supabase: SupabaseClient, hours: number): Promise<void> {
  const { error } = await supabase.rpc("calendar_open_party_leadership_windows", {
    p_hours: hours,
  });
  if (error) console.warn("[calendar] calendar_open_party_leadership_windows:", error.message);
}

/**
 * January inauguration: seat pending seat races (excluding midterm/presidential calendar cycles),
 * then open chamber leadership sessions + party officer windows.
 */
export async function handleInauguration(supabase: SupabaseClient, year: number): Promise<void> {
  const key = `inauguration_${year}`;
  const settings = await loadSimulationSettings(supabase);
  const simStart = settings?.simulation_start_at ?? null;

  // TODO: Discord webhook — announce inauguration, new Congress seated, leadership elections open #announcements

  await seatInaugurationCalendarElections(supabase, simStart);

  if (await calendarSuccessExists(supabase, key)) {
    // Milestone already logged (e.g. after a prior reset) but DB can be missing races if inserts failed earlier.
    await openChamberLeadershipSessionsIfNone(supabase);
    return;
  }

  await resetCongressionalLeadershipForNewTerm(supabase, simStart);

  await openChamberLeadershipSessionsIfNone(supabase);
  await rpcOpenPartyLeadershipWindows(supabase, CALENDAR_LEADERSHIP_WINDOW_HOURS);

  const sched = leadershipRaceScheduleFromNow();
  await insertCalendarEventSuccess(supabase, key, {
    year,
    leadership_filing_opens_at: sched.filing_opens_at,
    leadership_general_closes_at: sched.general_closes_at,
  });
}

export type LeadershipCloseContext =
  | { kind: "inauguration"; year: number }
  | { kind: "midterm"; cycleYear: number }
  | { kind: "post_presidential"; cycleOpenYear: number };

function leadershipCloseEventKey(ctx: LeadershipCloseContext): string {
  switch (ctx.kind) {
    case "inauguration":
      return `leadership_close_${ctx.year}`;
    case "midterm":
      return `leadership_close_midterm_${ctx.cycleYear}`;
    case "post_presidential":
      return `leadership_close_post_pres_${ctx.cycleOpenYear}`;
  }
}

/** Milestone after chamber leadership sessions end: advance seat-election phases only. */
export async function handleLeadershipClose(
  supabase: SupabaseClient,
  ctx: LeadershipCloseContext,
): Promise<void> {
  const key = leadershipCloseEventKey(ctx);
  if (await calendarSuccessExists(supabase, key)) return;

  // TODO: Discord webhook — leadership session outcomes are tallied when closes_at passes #announcements

  const { error } = await supabase.rpc("advance_election_phases_by_schedule");
  if (error) {
    await insertCalendarEventError(supabase, {
      event_key: key,
      error_message: `advance_election_phases_by_schedule: ${error.message}`,
      metadata: { step: "leadership_close", kind: ctx.kind },
    });
    return;
  }

  await insertCalendarEventSuccess(supabase, key, {
    kind: ctx.kind,
    year: ctx.kind === "inauguration" ? ctx.year : undefined,
    cycleYear: ctx.kind === "midterm" ? ctx.cycleYear : undefined,
    cycleOpenYear: ctx.kind === "post_presidential" ? ctx.cycleOpenYear : undefined,
  });
}

export async function handleBudgetCycleOpen(supabase: SupabaseClient, rpYear: number): Promise<void> {
  const key = `budget_open_${rpYear}_09`;
  if (await calendarSuccessExists(supabase, key)) return;

  // Staff start the IRL appropriations countdown from Admin → Economy overview (no automatic FY deadline writes).

  await insertCalendarEventSuccess(supabase, key, {
    rpYear,
    note: "September RP month — remind staff to start appropriations window if needed.",
  });
}

export async function handleBudgetDeadlineMiss(supabase: SupabaseClient, rpYear: number): Promise<void> {
  const key = `budget_deadline_${rpYear}_10`;
  if (await calendarSuccessExists(supabase, key)) return;

  const { data: fy } = await supabase
    .from("rp_fiscal_years")
    .select("id, appropriations_act_bill_id")
    .eq("status", "active")
    .maybeSingle();

  if ((fy as { appropriations_act_bill_id?: string } | null)?.appropriations_act_bill_id) {
    await insertCalendarEventSuccess(supabase, key, { skipped: true, reason: "appropriations_enrolled" });
    return;
  }

  // Do not auto-freeze the economy — staff shut down manually via rp_fiscal_years.economy_activity_frozen.
  await insertCalendarEventSuccess(supabase, key, { rpYear, manual_shutdown_only: true });
}

async function loadAllDistrictCodes(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase.from("districts").select("code").order("code");
  return (data ?? []).map((r) => String((r as { code: string }).code).trim().toUpperCase()).filter(Boolean);
}

async function loadStateCodes(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase.from("states").select("code").order("code");
  return (data ?? []).map((r) => String((r as { code: string }).code).trim().toUpperCase()).filter(Boolean);
}

async function electionExistsForCycle(
  supabase: SupabaseClient,
  cycleKey: string,
  filter: { office: string; district_code?: string | null; state?: string | null; senate_class?: number | null },
): Promise<boolean> {
  let q = supabase.from("elections").select("id").eq("calendar_cycle_key", cycleKey).eq("office", filter.office);
  if (filter.office === "house") {
    const d = (filter.district_code ?? "").trim().toUpperCase();
    q = q.eq("district_code", d);
  } else if (filter.office === "senate") {
    const st = (filter.state ?? "").trim().toUpperCase();
    q = q.eq("state", st).eq("senate_class", filter.senate_class ?? 0);
  }
  const { data } = await q.maybeSingle();
  return Boolean(data);
}

async function insertSeatRace(
  supabase: SupabaseClient,
  row: {
    office: "house" | "senate" | "president";
    state: string | null;
    district_code: string | null;
    senate_class: number | null;
    calendar_cycle_key: string;
  },
  schedule: SeatRaceSchedule,
): Promise<void> {
  const { filing_opens_at, filing_closes_at, primary_closes_at, general_closes_at } = schedule;
  const { error } = await supabase.from("elections").insert({
    office: row.office,
    state: row.state,
    district_code: row.district_code,
    senate_class: row.senate_class,
    phase: "filing",
    filing_opens_at,
    filing_closes_at,
    primary_closes_at,
    general_closes_at,
    primary_party_wide: true,
    filing_window_started_at: filing_opens_at,
    calendar_cycle_key: row.calendar_cycle_key,
  });
  if (error) console.warn("[calendar] insertSeatRace", row, error.message);
}

/**
 * @param electionYear U.S. midterm **election** year (e.g. 2030). `calendar_cycle_key` is `midterms_<year>`.
 * Opens when RP first reaches **November** of that year; freezes RP at that month until seating.
 */
export async function handleMidtermElectionOpen(supabase: SupabaseClient, electionYear: number): Promise<void> {
  const eventKey = `midterms_open_${electionYear}`;
  if (await calendarSuccessExists(supabase, eventKey)) return;

  const cycleKey = `midterms_${electionYear}`;
  const schedule = seatRaceScheduleFromNow();

  const districts = await loadAllDistrictCodes(supabase);
  for (const code of districts) {
    if (await electionExistsForCycle(supabase, cycleKey, { office: "house", district_code: code })) continue;
    await insertSeatRace(
      supabase,
      {
        office: "house",
        state: code.slice(0, 2),
        district_code: code,
        senate_class: null,
        calendar_cycle_key: cycleKey,
      },
      schedule,
    );
  }

  const states = await loadStateCodes(supabase);
  for (const st of states) {
    if (await electionExistsForCycle(supabase, cycleKey, { office: "senate", state: st, senate_class: 2 }))
      continue;
    await insertSeatRace(
      supabase,
      {
        office: "senate",
        state: st,
        district_code: null,
        senate_class: 2,
        calendar_cycle_key: cycleKey,
      },
      schedule,
    );
  }

  // TODO: Discord webhook — midterm elections open #announcements

  await insertCalendarEventSuccess(supabase, eventKey, { electionYear, cycleKey });

  const freezeAt = new Date();
  const { error: frErr } = await supabase
    .from("simulation_settings")
    .update({
      calendar_seat_cycle_freeze_rp_year: electionYear,
      calendar_seat_cycle_freeze_rp_month: 11,
      updated_at: freezeAt.toISOString(),
    })
    .eq("id", 1);
  if (frErr) console.warn("[calendar] midterm RP freeze:", frErr.message);
}

/**
 * @param electionYear U.S. presidential **general election** year (e.g. 2032 for Nov 2032). Races use
 * `calendar_cycle_key = presidential_<year>`. Opens when RP first reaches **November** of that year; freezes RP until seating.
 */
export async function handlePresidentialElectionOpen(supabase: SupabaseClient, electionYear: number): Promise<void> {
  const eventKey = `presidential_election_open_${electionYear}`;
  if (await calendarSuccessExists(supabase, eventKey)) return;

  const cycleKey = `presidential_${electionYear}`;
  const schedule = seatRaceScheduleFromNow();

  const districts = await loadAllDistrictCodes(supabase);
  for (const code of districts) {
    if (await electionExistsForCycle(supabase, cycleKey, { office: "house", district_code: code })) continue;
    await insertSeatRace(
      supabase,
      {
        office: "house",
        state: code.slice(0, 2),
        district_code: code,
        senate_class: null,
        calendar_cycle_key: cycleKey,
      },
      schedule,
    );
  }

  const states = await loadStateCodes(supabase);
  for (const st of states) {
    if (await electionExistsForCycle(supabase, cycleKey, { office: "senate", state: st, senate_class: 3 }))
      continue;
    await insertSeatRace(
      supabase,
      {
        office: "senate",
        state: st,
        district_code: null,
        senate_class: 3,
        calendar_cycle_key: cycleKey,
      },
      schedule,
    );
  }

  const { data: presExists } = await supabase
    .from("elections")
    .select("id")
    .eq("calendar_cycle_key", cycleKey)
    .eq("office", "president")
    .maybeSingle();

  if (!presExists) {
    const { filing_opens_at, filing_closes_at, primary_closes_at, general_closes_at } = schedule;
    await supabase.from("elections").insert({
      office: "president",
      state: null,
      district_code: null,
      senate_class: null,
      phase: "filing",
      filing_opens_at,
      filing_closes_at,
      primary_closes_at,
      general_closes_at,
      primary_party_wide: true,
      filing_window_started_at: filing_opens_at,
      calendar_cycle_key: cycleKey,
    });
  }

  // TODO: Discord webhook — presidential election cycle open #announcements

  await insertCalendarEventSuccess(supabase, eventKey, { electionYear, cycleKey });

  const freezeAt = new Date();
  const { error: frErr } = await supabase
    .from("simulation_settings")
    .update({
      calendar_seat_cycle_freeze_rp_year: electionYear,
      calendar_seat_cycle_freeze_rp_month: 11,
      updated_at: freezeAt.toISOString(),
    })
    .eq("id", 1);
  if (frErr) console.warn("[calendar] presidential RP freeze:", frErr.message);
}

async function allCycleSeatRacesClosed(supabase: SupabaseClient, cycleKey: string): Promise<boolean> {
  const { data: rows } = await supabase
    .from("elections")
    .select("phase")
    .eq("calendar_cycle_key", cycleKey)
    .is("leadership_role", null);

  if (!rows?.length) return false;

  return (rows as { phase: string }[]).every((r) => r.phase === "closed");
}

async function seatCalendarCycleElections(supabase: SupabaseClient, cycleKey: string): Promise<number> {
  const { data: rows } = await supabase
    .from("elections")
    .select("id, office, state, district_code, senate_class, winner_user_id")
    .eq("calendar_cycle_key", cycleKey)
    .eq("phase", "closed")
    .is("leadership_role", null)
    .is("calendar_seated_at", null);

  let n = 0;
  for (const raw of rows ?? []) {
    await processSeatElectionCalendarSeating(supabase, raw as SeatElectionRow);
    n += 1;
  }
  return n;
}

/**
 * @param electionYear Same U.S. midterm election year as {@link handleMidtermElectionOpen} (e.g. 2030).
 * After seating, RP is snapped to **January (electionYear + 1)** (new Congress year).
 */
export async function handleMidtermSeating(supabase: SupabaseClient, electionYear: number): Promise<void> {
  const eventKey = `midterms_seated_${electionYear}`;
  if (await calendarSuccessExists(supabase, eventKey)) {
    await openChamberLeadershipSessionsIfNone(supabase);
    return;
  }

  const cycleKey = `midterms_${electionYear}`;
  if (!(await allCycleSeatRacesClosed(supabase, cycleKey))) return;

  // TODO: Discord webhook — midterm results certified #announcements

  await seatCalendarCycleElections(supabase, cycleKey);

  const settings = await loadSimulationSettings(supabase);
  await resetCongressionalLeadershipForNewTerm(supabase, settings?.simulation_start_at ?? null);

  await openChamberLeadershipSessionsIfNone(supabase);
  await rpcOpenPartyLeadershipWindows(supabase, CALENDAR_LEADERSHIP_WINDOW_HOURS);

  const anchorMid = new Date();
  const congressJanuaryYear = electionYear + 1;
  const startAtMid = isoSimulationStartForRpInstantAt(anchorMid, congressJanuaryYear, 1);
  const { error: snapMidErr } = await supabase
    .from("simulation_settings")
    .update({
      simulation_start_at: startAtMid,
      calendar_seat_cycle_freeze_rp_year: null,
      calendar_seat_cycle_freeze_rp_month: null,
      updated_at: anchorMid.toISOString(),
    })
    .eq("id", 1);
  if (snapMidErr) {
    console.warn("[calendar] simulation_start_at snap after midterm seating:", snapMidErr.message);
  }

  await insertCalendarEventSuccess(supabase, eventKey, { electionYear, congressJanuaryYear, cycleKey });
}

/**
 * @param electionYear Same as {@link handlePresidentialElectionOpen} (e.g. 2032). After seating, RP snaps to
 * **January (electionYear + 1)** (e.g. Jan 2033 inauguration).
 */
export async function handlePresidentialCycleSeating(supabase: SupabaseClient, electionYear: number): Promise<void> {
  const eventKey = `presidential_seated_${electionYear}`;
  if (await calendarSuccessExists(supabase, eventKey)) {
    await openChamberLeadershipSessionsIfNone(supabase);
    return;
  }

  const cycleKey = `presidential_${electionYear}`;
  if (!(await allCycleSeatRacesClosed(supabase, cycleKey))) return;

  await seatCalendarCycleElections(supabase, cycleKey);

  const settings = await loadSimulationSettings(supabase);
  await resetCongressionalLeadershipForNewTerm(supabase, settings?.simulation_start_at ?? null);

  await openChamberLeadershipSessionsIfNone(supabase);
  await rpcOpenPartyLeadershipWindows(supabase, CALENDAR_LEADERSHIP_WINDOW_HOURS);

  const anchorPres = new Date();
  const inaugurationJanuaryYear = electionYear + 1;
  const startAtPres = isoSimulationStartForRpInstantAt(anchorPres, inaugurationJanuaryYear, 1);
  const { error: snapPresErr } = await supabase
    .from("simulation_settings")
    .update({
      simulation_start_at: startAtPres,
      calendar_seat_cycle_freeze_rp_year: null,
      calendar_seat_cycle_freeze_rp_month: null,
      updated_at: anchorPres.toISOString(),
    })
    .eq("id", 1);
  if (snapPresErr) {
    console.warn("[calendar] simulation_start_at snap after presidential seating:", snapPresErr.message);
  }

  await insertCalendarEventSuccess(supabase, eventKey, {
    electionYear,
    inaugurationJanuaryYear,
    cycleKey,
  });
}

/** Staff-triggered: open House/Senate `leadership_sessions` when none are open (same helper as inauguration / seating). */
export async function adminManualOpenChamberLeadershipSessions(supabase: SupabaseClient): Promise<void> {
  await openChamberLeadershipSessionsIfNone(supabase);
}

/** Staff-triggered: D/R party officer filing windows (same wall-clock window as calendar automation). */
export async function adminManualOpenPartyLeadershipWindows(supabase: SupabaseClient): Promise<void> {
  await rpcOpenPartyLeadershipWindows(supabase, CALENDAR_LEADERSHIP_WINDOW_HOURS);
}
