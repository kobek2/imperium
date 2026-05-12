import type { SupabaseClient } from "@supabase/supabase-js";
import { autoCloseCalendarPresidentElectionsIfDue } from "@/lib/calendar-presidential-autoclose";
import {
  getSuccessfulCalendarEventFiredAt,
  insertCalendarEventError,
  loadSuccessfulCalendarEventKeys,
} from "@/lib/calendar-event-log";
import {
  handleBudgetCycleOpen,
  handleBudgetDeadlineMiss,
  handleInauguration,
  handleLeadershipClose,
  handleMidtermElectionOpen,
  handleMidtermSeating,
  handlePresidentialCycleSeating,
  handlePresidentialElectionOpen,
  type LeadershipCloseContext,
} from "@/lib/calendar-event-handlers";
import { computeRpDateForCalendarTick } from "@/lib/simulation-calendar-constants";
import type { SimulationSettingsRow } from "@/lib/simulation-calendar";
import {
  CALENDAR_LEADERSHIP_WINDOW_HOURS,
  CALENDAR_US_FEDERAL_SEAT_CYCLE_MAX_ELECTION_YEAR,
  US_INAUGURAL_RP_YEAR,
  US_MIDTERM_ELECTION_YEAR,
  US_PRESIDENTIAL_ELECTION_YEAR,
  rpAtOrPastMonth,
} from "@/lib/simulation-us-election-calendar";

export type SimulationSettingsV2 = SimulationSettingsRow & {
  simulation_start_at?: string | null;
  calendar_is_active?: boolean | null;
  simulation_start_unlocked?: boolean | null;
  calendar_seat_cycle_freeze_rp_year?: number | null;
  calendar_seat_cycle_freeze_rp_month?: number | null;
};

export async function getSimulationSettingsV2(supabase: SupabaseClient): Promise<SimulationSettingsV2 | null> {
  const { data, error } = await supabase.from("simulation_settings").select("*").eq("id", 1).maybeSingle();
  if (error || !data) return null;
  return data as SimulationSettingsV2;
}

function formatCalendarTickError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || String(err);
  return String(err);
}

async function runCalendarStep(
  supabase: SupabaseClient,
  eventKey: string,
  run: () => Promise<void>,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await run();
  } catch (e) {
    await insertCalendarEventError(supabase, {
      event_key: eventKey,
      error_message: formatCalendarTickError(e),
      metadata: { source: "calendar_tick", ...metadata },
    });
  }
}

const LEADERSHIP_CLOSE_DELAY_MS = CALENDAR_LEADERSHIP_WINDOW_HOURS * 60 * 60 * 1000;

async function maybeFireDeferredLeadershipCloses(
  supabase: SupabaseClient,
  fired: Set<string>,
  now: Date,
): Promise<void> {
  const jobs: Array<{
    parentKey: string;
    closeKey: string;
    ctx: LeadershipCloseContext;
  }> = [
    {
      parentKey: `inauguration_${US_INAUGURAL_RP_YEAR}`,
      closeKey: `leadership_close_${US_INAUGURAL_RP_YEAR}`,
      ctx: { kind: "inauguration", year: US_INAUGURAL_RP_YEAR },
    },
  ];
  for (
    let electionYear = US_MIDTERM_ELECTION_YEAR;
    electionYear <= CALENDAR_US_FEDERAL_SEAT_CYCLE_MAX_ELECTION_YEAR;
    electionYear += 4
  ) {
    jobs.push({
      parentKey: `midterms_seated_${electionYear}`,
      closeKey: `leadership_close_midterm_${electionYear}`,
      ctx: { kind: "midterm", cycleYear: electionYear },
    });
  }
  for (
    let electionYear = US_PRESIDENTIAL_ELECTION_YEAR;
    electionYear <= CALENDAR_US_FEDERAL_SEAT_CYCLE_MAX_ELECTION_YEAR;
    electionYear += 4
  ) {
    jobs.push({
      parentKey: `presidential_seated_${electionYear}`,
      closeKey: `leadership_close_post_pres_${electionYear}`,
      ctx: { kind: "post_presidential", cycleOpenYear: electionYear },
    });
  }

  for (const job of jobs) {
    if (!fired.has(job.parentKey) || fired.has(job.closeKey)) continue;
    const firedAt = await getSuccessfulCalendarEventFiredAt(supabase, job.parentKey);
    if (!firedAt) continue;
    if (now.getTime() < firedAt.getTime() + LEADERSHIP_CLOSE_DELAY_MS) continue;
    await runCalendarStep(supabase, job.closeKey, () => handleLeadershipClose(supabase, job.ctx), {
      leadership_close: job.closeKey,
      parent_event: job.parentKey,
    });
  }
}

/**
 * Runs automated calendar events when `calendar_is_active` is true.
 * Safe to call from cron or after reads; no-ops when inactive.
 *
 * U.S. cadence vs. RP opens/seating: see {@link US_MIDTERM_ELECTION_YEAR} and related exports in
 * `simulation-us-election-calendar.ts`.
 */
export async function tickCalendarEvents(supabase: SupabaseClient): Promise<void> {
  const settings = await getSimulationSettingsV2(supabase);
  if (!settings?.calendar_is_active || !settings.simulation_start_at) return;

  const now = new Date();
  const start = new Date(settings.simulation_start_at);
  if (Number.isNaN(start.getTime())) return;

  const { error: advErr } = await supabase.rpc("advance_election_phases_by_schedule");
  if (advErr) {
    await insertCalendarEventError(supabase, {
      event_key: "cron_advance_election_phases",
      error_message: advErr.message,
      metadata: { source: "calendar_tick", rpc: "advance_election_phases_by_schedule" },
    });
  }

  const { error: lsAdvErr } = await supabase.rpc("advance_leadership_sessions_by_schedule");
  if (lsAdvErr) {
    await insertCalendarEventError(supabase, {
      event_key: "cron_advance_leadership_sessions",
      error_message: lsAdvErr.message,
      metadata: { source: "calendar_tick", rpc: "advance_leadership_sessions_by_schedule" },
    });
  }

  await runCalendarStep(supabase, "cron_presidential_autoclose", () => autoCloseCalendarPresidentElectionsIfDue(supabase), {
    step: "autoCloseCalendarPresidentElectionsIfDue",
  });

  /** Seat-cycle freeze holds RP (and thus budget / inauguration gates) until seating — avoids natural RP sprinting during 72h races. */
  const rp = computeRpDateForCalendarTick(
    start,
    now,
    settings.calendar_seat_cycle_freeze_rp_year,
    settings.calendar_seat_cycle_freeze_rp_month,
  );

  let fired = await loadSuccessfulCalendarEventKeys(supabase);

  const pending: Array<{ key: string; run: () => Promise<void> }> = [];

  if (rpAtOrPastMonth(rp, { year: US_INAUGURAL_RP_YEAR, month: 1 }) && !fired.has(`inauguration_${US_INAUGURAL_RP_YEAR}`)) {
    pending.push({ key: `inauguration_${US_INAUGURAL_RP_YEAR}`, run: () => handleInauguration(supabase, US_INAUGURAL_RP_YEAR) });
  }

  if (rp.year === 2029 && rp.month >= 9 && !fired.has("budget_open_2029_09")) {
    pending.push({ key: "budget_open_2029_09", run: () => handleBudgetCycleOpen(supabase, 2029) });
  }

  if (rp.year === 2029 && rp.month >= 10 && !fired.has("budget_deadline_2029_10")) {
    pending.push({ key: "budget_deadline_2029_10", run: () => handleBudgetDeadlineMiss(supabase, 2029) });
  }

  for (
    let electionYear = US_MIDTERM_ELECTION_YEAR;
    electionYear <= CALENDAR_US_FEDERAL_SEAT_CYCLE_MAX_ELECTION_YEAR;
    electionYear += 4
  ) {
    if (
      rpAtOrPastMonth(rp, { year: electionYear, month: 11 }) &&
      !fired.has(`midterms_open_${electionYear}`)
    ) {
      pending.push({
        key: `midterms_open_${electionYear}`,
        run: () => handleMidtermElectionOpen(supabase, electionYear),
      });
    }
  }

  for (
    let electionYear = US_PRESIDENTIAL_ELECTION_YEAR;
    electionYear <= CALENDAR_US_FEDERAL_SEAT_CYCLE_MAX_ELECTION_YEAR;
    electionYear += 4
  ) {
    if (
      rpAtOrPastMonth(rp, { year: electionYear, month: 11 }) &&
      !fired.has(`presidential_election_open_${electionYear}`)
    ) {
      pending.push({
        key: `presidential_election_open_${electionYear}`,
        run: () => handlePresidentialElectionOpen(supabase, electionYear),
      });
    }
  }

  for (let y = 2030; y <= 2038; y += 1) {
    const openKey = `budget_open_${y}_09`;
    const deadKey = `budget_deadline_${y}_10`;
    if (rp.year === y && rp.month >= 9 && !fired.has(openKey)) {
      pending.push({ key: openKey, run: () => handleBudgetCycleOpen(supabase, y) });
    }
    if (rp.year === y && rp.month >= 10 && !fired.has(deadKey)) {
      pending.push({ key: deadKey, run: () => handleBudgetDeadlineMiss(supabase, y) });
    }
  }

  pending.sort((a, b) => a.key.localeCompare(b.key));

  for (const p of pending) {
    if (fired.has(p.key)) continue;
    await runCalendarStep(supabase, p.key, p.run);
  }

  fired = await loadSuccessfulCalendarEventKeys(supabase);

  for (
    let electionYear = US_MIDTERM_ELECTION_YEAR;
    electionYear <= CALENDAR_US_FEDERAL_SEAT_CYCLE_MAX_ELECTION_YEAR;
    electionYear += 4
  ) {
    await runCalendarStep(
      supabase,
      `midterms_seated_${electionYear}`,
      () => handleMidtermSeating(supabase, electionYear),
      { step: "handleMidtermSeating", electionYear },
    );
  }
  for (
    let electionYear = US_PRESIDENTIAL_ELECTION_YEAR;
    electionYear <= CALENDAR_US_FEDERAL_SEAT_CYCLE_MAX_ELECTION_YEAR;
    electionYear += 4
  ) {
    await runCalendarStep(
      supabase,
      `presidential_seated_${electionYear}`,
      () => handlePresidentialCycleSeating(supabase, electionYear),
      { step: "handlePresidentialCycleSeating", electionYear },
    );
  }

  fired = await loadSuccessfulCalendarEventKeys(supabase);
  await maybeFireDeferredLeadershipCloses(supabase, fired, now);
}
