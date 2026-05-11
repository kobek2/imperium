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
import { computeRpDate } from "@/lib/simulation-calendar-constants";
import type { SimulationSettingsRow } from "@/lib/simulation-calendar";
import {
  RP_YEAR_MONTH_FIRST_OPEN_MIDTERM_SEAT_CYCLE,
  RP_YEAR_MONTH_FIRST_OPEN_PRESIDENTIAL_SEAT_CYCLE,
  US_INAUGURAL_RP_YEAR,
  US_MIDTERM_ELECTION_YEAR,
  US_PRESIDENTIAL_ELECTION_YEAR,
  rpAtOrPastMonth,
} from "@/lib/simulation-us-election-calendar";

export type SimulationSettingsV2 = SimulationSettingsRow & {
  simulation_start_at?: string | null;
  calendar_is_active?: boolean | null;
  simulation_start_unlocked?: boolean | null;
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

const LEADERSHIP_CLOSE_DELAY_MS = 25 * 60 * 60 * 1000;

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
    {
      parentKey: `midterms_seated_${US_MIDTERM_ELECTION_YEAR}`,
      closeKey: `leadership_close_midterm_${US_MIDTERM_ELECTION_YEAR}`,
      ctx: { kind: "midterm", cycleYear: US_MIDTERM_ELECTION_YEAR },
    },
    {
      parentKey: `presidential_seated_${US_PRESIDENTIAL_ELECTION_YEAR}`,
      closeKey: `leadership_close_post_pres_${US_PRESIDENTIAL_ELECTION_YEAR}`,
      ctx: { kind: "post_presidential", cycleOpenYear: US_PRESIDENTIAL_ELECTION_YEAR },
    },
  ];

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

  const rp = computeRpDate(start, now);

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

  if (
    rpAtOrPastMonth(rp, RP_YEAR_MONTH_FIRST_OPEN_MIDTERM_SEAT_CYCLE) &&
    !fired.has(`midterms_open_${US_MIDTERM_ELECTION_YEAR}`)
  ) {
    pending.push({
      key: `midterms_open_${US_MIDTERM_ELECTION_YEAR}`,
      run: () => handleMidtermElectionOpen(supabase, US_MIDTERM_ELECTION_YEAR),
    });
  }

  if (
    rpAtOrPastMonth(rp, RP_YEAR_MONTH_FIRST_OPEN_PRESIDENTIAL_SEAT_CYCLE) &&
    !fired.has(`presidential_election_open_${US_PRESIDENTIAL_ELECTION_YEAR}`)
  ) {
    pending.push({
      key: `presidential_election_open_${US_PRESIDENTIAL_ELECTION_YEAR}`,
      run: () => handlePresidentialElectionOpen(supabase, US_PRESIDENTIAL_ELECTION_YEAR),
    });
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

  await runCalendarStep(
    supabase,
    `midterms_seated_${US_MIDTERM_ELECTION_YEAR}`,
    () => handleMidtermSeating(supabase, US_MIDTERM_ELECTION_YEAR),
    { step: "handleMidtermSeating" },
  );
  await runCalendarStep(
    supabase,
    `presidential_seated_${US_PRESIDENTIAL_ELECTION_YEAR}`,
    () => handlePresidentialCycleSeating(supabase, US_PRESIDENTIAL_ELECTION_YEAR),
    { step: "handlePresidentialCycleSeating" },
  );

  fired = await loadSuccessfulCalendarEventKeys(supabase);
  await maybeFireDeferredLeadershipCloses(supabase, fired, now);
}
