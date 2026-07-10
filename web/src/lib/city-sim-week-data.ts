import type { SupabaseClient } from "@supabase/supabase-js";
import { NYC_CITY_CODE } from "@/lib/city";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import {
  activeCouncilClassForYear,
  mayorElectionActiveForYear,
  normalizeCampaignPhase,
  type CityCyclePhase,
  type CitySimWeekStatus,
} from "@/lib/city-sim-week";

export async function runCityRealtimeTick(
  supabase: SupabaseClient,
  cityCode = NYC_CITY_CODE,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("tick_city_realtime_scheduler", { p_city_code: cityCode });
    if (error) console.warn("[city-realtime] tick:", error.message);
  } catch (err) {
    console.warn("[city-realtime] tick failed:", err);
  }
}

/** Page-load backup for city realtime automation (replaces Vercel cron). Never blocks render long. */
export async function runBackgroundSimTicks(supabase: SupabaseClient): Promise<void> {
  const timeoutMs = 6_000;
  try {
    await Promise.race([
      Promise.all([runCityRealtimeTick(supabase), runElectionPhaseSchedule(supabase)]),
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch (err) {
    console.warn("[background-sim-ticks] failed:", err);
  }
}

export async function reopenCityBienniumBudgetIfNeeded(
  supabase: SupabaseClient,
  cityCode = NYC_CITY_CODE,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("reopen_city_biennium_budget_if_needed", {
      p_city_code: cityCode,
    });
    if (error) console.warn("[city-budget-reopen]", error.message);
  } catch (err) {
    console.warn("[city-budget-reopen] failed:", err);
  }
}

export async function loadCitySimWeekStatus(
  supabase: SupabaseClient,
  cityCode = NYC_CITY_CODE,
): Promise<CitySimWeekStatus> {
  await reopenCityBienniumBudgetIfNeeded(supabase, cityCode);
  await runCityRealtimeTick(supabase, cityCode);

  const { data, error } = await supabase.rpc("get_city_sim_week_status", {
    p_city_code: cityCode,
  });

  if (error) {
    console.warn("[city-sim-week-data] status:", error.message);
    return emptyCitySimWeekStatus(cityCode);
  }

  const row = data as Record<string, unknown> | null;
  return mapCitySimWeekStatus(row, cityCode);
}

export function mapCitySimWeekStatus(
  row: Record<string, unknown> | null,
  cityCode = NYC_CITY_CODE,
): CitySimWeekStatus {
  const simYear = Number(row?.sim_year ?? 1);
  const rawPhase = String(row?.cycle_phase ?? row?.turn_phase ?? "legislative");
  const cyclePhase: CityCyclePhase =
    rawPhase === "sign_ups_open" ||
    rawPhase === "primaries" ||
    rawPhase === "generals" ||
    rawPhase === "legislative"
      ? rawPhase
      : "legislative";

  return {
    cityCode,
    simYear,
    simWeek: simYear,
    simTurn: null,
    simTick: Number(row?.sim_tick ?? 0),
    turnPhase: cyclePhase,
    cyclePhase,
    bienniumIndex: Number(row?.biennium_index ?? 1),
    activeCouncilClass:
      row?.active_council_class === "A" || row?.active_council_class === "B"
        ? row.active_council_class
        : activeCouncilClassForYear(simYear),
    mayorElectionActive:
      typeof row?.mayor_election_active === "boolean"
        ? row.mayor_election_active
        : mayorElectionActiveForYear(simYear),
    budgetProposalOpen: Boolean(row?.budget_propose_allowed ?? row?.budget_proposal_open),
    budgetEnacted: Boolean(row?.budget_enacted),
    budgetPassed: Boolean(row?.budget_passed ?? row?.budget_enacted),
    ordinancesAllowed: Boolean(row?.ordinances_allowed),
    phaseChanged: Boolean(row?.phase_changed),
    phaseEndsAt: row?.phase_ends_at ? String(row.phase_ends_at) : null,
    campaignActive: Boolean(row?.campaign_active),
    campaignCycle: Number(row?.campaign_cycle ?? 1),
    campaignTurn: Number(row?.campaign_turn ?? 1),
    campaignPhase: normalizeCampaignPhase(row?.campaign_phase as string | undefined),
  };
}

export function emptyCitySimWeekStatus(cityCode = NYC_CITY_CODE): CitySimWeekStatus {
  return {
    cityCode,
    simYear: 1,
    simWeek: 1,
    simTurn: null,
    simTick: 0,
    turnPhase: "sign_ups_open",
    cyclePhase: "sign_ups_open",
    bienniumIndex: 1,
    activeCouncilClass: "A",
    mayorElectionActive: true,
    budgetProposalOpen: true,
    budgetEnacted: false,
    budgetPassed: false,
    ordinancesAllowed: false,
    phaseChanged: false,
    phaseEndsAt: null,
    campaignActive: false,
    campaignCycle: 1,
    campaignTurn: 1,
    campaignPhase: null,
  };
}
