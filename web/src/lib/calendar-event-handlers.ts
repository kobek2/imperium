import type { SupabaseClient } from "@supabase/supabase-js";
import { addHours } from "date-fns";
import {
  leadershipRaceScheduleFromNow,
  processSeatElectionCalendarSeating,
  seatRaceScheduleFromNow,
  type SeatElectionRow,
} from "@/lib/calendar-seating-helpers";
import {
  calendarSuccessExists,
  insertCalendarEventError,
  insertCalendarEventSuccess,
} from "@/lib/calendar-event-log";
import type { SimulationSettingsRow } from "@/lib/simulation-calendar";

const NON_TERMINAL_BILL_STATUSES = [
  "submitted",
  "leadership_review",
  "on_docket",
  "debate",
  "house_committee",
  "house_floor",
  "senate_committee",
  "senate_floor",
  "other_chamber_review",
  "other_chamber_debate",
  "passed_congress",
  "oval",
] as const;

async function expireOpenBills(supabase: SupabaseClient, reason: string): Promise<void> {
  await supabase
    .from("bills")
    .update({
      status: "expired",
      bill_closure_reason: reason,
      leadership_deadline_at: null,
      chamber_vote_deadline_at: null,
      leadership_primary_deadline: null,
      leadership_deputy_deadline: null,
    })
    .in("status", [...NON_TERMINAL_BILL_STATUSES]);
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

async function countActiveChamberLeadershipRace(
  supabase: SupabaseClient,
  leadershipRole: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("elections")
    .select("id", { count: "exact", head: true })
    .eq("leadership_role", leadershipRole)
    .in("phase", ["filing", "primary", "general"]);
  if (error) return 0;
  return count ?? 0;
}

async function openChamberLeadershipRacesIfNone(supabase: SupabaseClient): Promise<void> {
  const sched = leadershipRaceScheduleFromNow();
  const { filing_opens_at, filing_closes_at, general_closes_at } = sched;
  const primary_closes_at = filing_closes_at;

  if ((await countActiveChamberLeadershipRace(supabase, "speaker")) === 0) {
    await supabase.from("elections").insert({
      office: "house",
      leadership_role: "speaker",
      phase: "filing",
      filing_opens_at,
      filing_closes_at,
      primary_closes_at,
      general_closes_at,
      primary_party_wide: true,
      filing_window_started_at: filing_opens_at,
    });
  }

  if ((await countActiveChamberLeadershipRace(supabase, "senate_majority_leader")) === 0) {
    await supabase.from("elections").insert({
      office: "senate",
      leadership_role: "senate_majority_leader",
      phase: "filing",
      filing_opens_at,
      filing_closes_at,
      primary_closes_at,
      general_closes_at,
      primary_party_wide: true,
      filing_window_started_at: filing_opens_at,
    });
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
 * expire prior Congress bills, open Speaker + Majority Leader + party officer windows.
 */
export async function handleInauguration(supabase: SupabaseClient, year: number): Promise<void> {
  const key = `inauguration_${year}`;
  const settings = await loadSimulationSettings(supabase);
  const simStart = settings?.simulation_start_at ?? null;

  // TODO: Discord webhook — announce inauguration, new Congress seated, leadership elections open #announcements

  await seatInaugurationCalendarElections(supabase, simStart);

  if (await calendarSuccessExists(supabase, key)) return;

  await expireOpenBills(supabase, "new_congress");
  await openChamberLeadershipRacesIfNone(supabase);
  await rpcOpenPartyLeadershipWindows(supabase, 25);

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

function noCandidatesLogKey(chamber: "house" | "senate", ctx: LeadershipCloseContext): string {
  const suffix =
    ctx.kind === "inauguration"
      ? String(ctx.year)
      : ctx.kind === "midterm"
        ? String(ctx.cycleYear)
        : String(ctx.cycleOpenYear);
  return `leadership_close_no_candidates_${chamber}_${suffix}`;
}

async function tallyGeneralVotesByCandidate(
  supabase: SupabaseClient,
  electionId: string,
): Promise<Map<string, number>> {
  const { data } = await supabase.from("general_votes").select("candidate_id").eq("election_id", electionId);
  const m = new Map<string, number>();
  for (const row of data ?? []) {
    const id = String((row as { candidate_id: string }).candidate_id);
    m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

type CandRow = { id: string; user_id: string; created_at: string | null };

async function assignDeputyFromLeadershipRace(
  supabase: SupabaseClient,
  leadershipRole: "speaker" | "senate_majority_leader",
  deputyGrantKey: "house_deputy" | "senate_deputy",
  ctx: LeadershipCloseContext,
  chamberLabel: "house" | "senate",
  simStartIso: string | null,
): Promise<void> {
  let q = supabase
    .from("elections")
    .select("id, winner_user_id, phase")
    .eq("leadership_role", leadershipRole)
    .eq("phase", "closed");
  if (simStartIso) {
    q = q.gte("filing_opens_at", simStartIso);
  }
  const { data: election } = await q
    .order("general_closes_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!election?.id) return;

  const electionId = String(election.id);
  const winnerUid = election.winner_user_id as string | null;
  if (!winnerUid) {
    await supabase.from("government_role_grants").delete().eq("role_key", deputyGrantKey);
    return;
  }

  const { count: candCount } = await supabase
    .from("election_candidates")
    .select("id", { count: "exact", head: true })
    .eq("election_id", electionId);

  if ((candCount ?? 0) === 0) {
    await insertCalendarEventSuccess(supabase, noCandidatesLogKey(chamberLabel, ctx), {
      leadership_role: leadershipRole,
      election_id: electionId,
    });
    await supabase.from("government_role_grants").delete().eq("role_key", deputyGrantKey);
    return;
  }

  if ((candCount ?? 0) === 1) {
    await supabase.from("government_role_grants").delete().eq("role_key", deputyGrantKey);
    return;
  }

  const { data: cands } = await supabase
    .from("election_candidates")
    .select("id, user_id, created_at")
    .eq("election_id", electionId);

  const list = (cands ?? []) as CandRow[];
  const tally = await tallyGeneralVotesByCandidate(supabase, electionId);

  const sorted = [...list].sort((a, b) => {
    const va = tally.get(a.id) ?? 0;
    const vb = tally.get(b.id) ?? 0;
    if (va !== vb) return vb - va;
    const ta = a.created_at ? new Date(a.created_at).getTime() : Number.MAX_SAFE_INTEGER;
    const tb = b.created_at ? new Date(b.created_at).getTime() : Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });

  if (!sorted.length) return;

  const deputy = sorted.find((c) => c.user_id !== winnerUid) ?? null;

  if (!deputy?.user_id) {
    await supabase.from("government_role_grants").delete().eq("role_key", deputyGrantKey);
    return;
  }

  await supabase.from("government_role_grants").delete().eq("role_key", deputyGrantKey);
  await supabase.from("government_role_grants").insert({ user_id: deputy.user_id, role_key: deputyGrantKey });
}

/** After leadership generals close: advance phases, assign Speaker/ML (SQL) + deputies from vote totals. */
export async function handleLeadershipClose(
  supabase: SupabaseClient,
  ctx: LeadershipCloseContext,
): Promise<void> {
  const key = leadershipCloseEventKey(ctx);
  if (await calendarSuccessExists(supabase, key)) return;

  // TODO: Discord webhook — announce new leaders and deputies #announcements

  const settings = await loadSimulationSettings(supabase);
  const simStartIso = settings?.simulation_start_at ?? null;

  const { error } = await supabase.rpc("advance_election_phases_by_schedule");
  if (error) {
    await insertCalendarEventError(supabase, {
      event_key: key,
      error_message: `advance_election_phases_by_schedule: ${error.message}`,
      metadata: { step: "leadership_close", kind: ctx.kind },
    });
    return;
  }

  await assignDeputyFromLeadershipRace(supabase, "speaker", "house_deputy", ctx, "house", simStartIso);
  await assignDeputyFromLeadershipRace(
    supabase,
    "senate_majority_leader",
    "senate_deputy",
    ctx,
    "senate",
    simStartIso,
  );

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

  // TODO: Discord webhook — budget window open, deadline approaching #announcements

  const hoursPerRpMonth = (10.5 / 48) * 24;

  const { data: fy } = await supabase.from("rp_fiscal_years").select("id").eq("status", "active").maybeSingle();
  if (fy?.id) {
    const deadline = addHours(new Date(), hoursPerRpMonth).toISOString();
    await supabase
      .from("rp_fiscal_years")
      .update({
        appropriation_deadline_at: deadline,
        appropriation_clock_started_at: new Date().toISOString(),
      })
      .eq("id", fy.id);
  }

  await insertCalendarEventSuccess(supabase, key, { rpYear });
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

  if (fy?.id) {
    await supabase.from("rp_fiscal_years").update({ economy_activity_frozen: true }).eq("id", fy.id);
  }

  // TODO: Discord webhook — government shutdown, economy frozen #announcements

  await insertCalendarEventSuccess(supabase, key, { rpYear });
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
  schedule: ReturnType<typeof seatRaceScheduleFromNow>,
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

export async function handleMidtermElectionOpen(supabase: SupabaseClient, rpYear: number): Promise<void> {
  const eventKey = `midterms_open_${rpYear}`;
  if (await calendarSuccessExists(supabase, eventKey)) return;

  const cycleKey = `midterms_${rpYear}`;
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

  await insertCalendarEventSuccess(supabase, eventKey, { rpYear, cycleKey });
}

export async function handlePresidentialElectionOpen(supabase: SupabaseClient, rpYear: number): Promise<void> {
  const eventKey = `presidential_election_open_${rpYear}`;
  if (await calendarSuccessExists(supabase, eventKey)) return;

  const cycleKey = `presidential_${rpYear}`;
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

  await insertCalendarEventSuccess(supabase, eventKey, { rpYear, cycleKey });
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

export async function handleMidtermSeating(supabase: SupabaseClient, rpYear: number): Promise<void> {
  const eventKey = `midterms_seated_${rpYear}`;
  if (await calendarSuccessExists(supabase, eventKey)) return;

  const cycleKey = `midterms_${rpYear}`;
  if (!(await allCycleSeatRacesClosed(supabase, cycleKey))) return;

  // TODO: Discord webhook — midterm results certified #announcements

  await seatCalendarCycleElections(supabase, cycleKey);

  await expireOpenBills(supabase, "new_congress");
  await openChamberLeadershipRacesIfNone(supabase);
  await rpcOpenPartyLeadershipWindows(supabase, 25);

  await insertCalendarEventSuccess(supabase, eventKey, { rpYear, cycleKey });
}

export async function handlePresidentialCycleSeating(supabase: SupabaseClient, rpYear: number): Promise<void> {
  const eventKey = `presidential_seated_${rpYear}`;
  if (await calendarSuccessExists(supabase, eventKey)) return;

  const cycleKey = `presidential_${rpYear}`;
  if (!(await allCycleSeatRacesClosed(supabase, cycleKey))) return;

  await seatCalendarCycleElections(supabase, cycleKey);

  await expireOpenBills(supabase, "new_congress");
  await openChamberLeadershipRacesIfNone(supabase);
  await rpcOpenPartyLeadershipWindows(supabase, 25);

  await insertCalendarEventSuccess(supabase, eventKey, { rpYear, cycleKey });
}
