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
      parentKey: "inauguration_2029",
      closeKey: "leadership_close_2029",
      ctx: { kind: "inauguration", year: 2029 },
    },
    {
      parentKey: "midterms_seated_2030",
      closeKey: "leadership_close_midterm_2030",
      ctx: { kind: "midterm", cycleYear: 2030 },
    },
    {
      parentKey: "presidential_seated_2033",
      closeKey: "leadership_close_post_pres_2033",
      ctx: { kind: "post_presidential", cycleOpenYear: 2033 },
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

  if (rp.year >= 2029 && rp.month >= 1 && !fired.has("inauguration_2029")) {
    pending.push({ key: "inauguration_2029", run: () => handleInauguration(supabase, 2029) });
  }

  if (rp.year === 2029 && rp.month >= 9 && !fired.has("budget_open_2029_09")) {
    pending.push({ key: "budget_open_2029_09", run: () => handleBudgetCycleOpen(supabase, 2029) });
  }

  if (rp.year === 2029 && rp.month >= 10 && !fired.has("budget_deadline_2029_10")) {
    pending.push({ key: "budget_deadline_2029_10", run: () => handleBudgetDeadlineMiss(supabase, 2029) });
  }

  // Midterm **election year** 2030 (U.S. usage); filings open first RP January after 2029 (RP Jan 2031).
  if (rp.year === 2031 && rp.month >= 1 && !fired.has("midterms_open_2030")) {
    pending.push({ key: "midterms_open_2030", run: () => handleMidtermElectionOpen(supabase, 2030) });
  }

  if (rp.year === 2033 && rp.month >= 1 && !fired.has("presidential_election_open_2033")) {
    pending.push({
      key: "presidential_election_open_2033",
      run: () => handlePresidentialElectionOpen(supabase, 2033),
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

  await runCalendarStep(supabase, "midterms_seated_2030", () => handleMidtermSeating(supabase, 2030), {
    step: "handleMidtermSeating",
  });
  await runCalendarStep(supabase, "presidential_seated_2033", () => handlePresidentialCycleSeating(supabase, 2033), {
    step: "handlePresidentialCycleSeating",
  });

  fired = await loadSuccessfulCalendarEventKeys(supabase);
  await maybeFireDeferredLeadershipCloses(supabase, fired, now);
}
