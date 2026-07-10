/** Real-time city sim calendar — wall-clock automation, no manual turns. */

export type CityCyclePhase =
  | "sign_ups_open"
  | "primaries"
  | "generals"
  | "legislative";

/** @deprecated Use CityCyclePhase */
export type CityTurnPhase = CityCyclePhase;

export type CitySimWeekStatus = {
  cityCode: string;
  simYear: number;
  simWeek: number;
  simTurn: number | null;
  simTick: number;
  turnPhase: CityCyclePhase;
  cyclePhase: CityCyclePhase;
  bienniumIndex: number;
  activeCouncilClass: "A" | "B";
  mayorElectionActive: boolean;
  budgetProposalOpen: boolean;
  budgetEnacted: boolean;
  budgetPassed: boolean;
  ordinancesAllowed: boolean;
  phaseChanged: boolean;
  phaseEndsAt: string | null;
  campaignActive: boolean;
  campaignCycle: number;
  campaignTurn: number;
  campaignPhase: "council" | "elections" | null;
};

/** 1 IRL week = 4 sim years → 42 wall-clock hours per sim year. */
export const CITY_SIM_YEAR_HOURS = 42;
/** Election + budget biennium cycle (2 sim years). */
export const CITY_CYCLE_HOURS = 84;
export const CITY_SIGNUPS_HOURS = 12;
export const CITY_PRIMARY_HOURS = 12;
export const CITY_GENERAL_HOURS = 24;
export const CITY_LEGISLATIVE_HOURS = 36;
export const CITY_BUDGET_CYCLE_YEARS = 2;

/** @deprecated Use CITY_SIM_YEAR_HOURS */
export const CITY_SIM_TURNS_PER_YEAR = 5;
export const CITY_SIM_TURN_DURATION_HOURS = 24;
export const CITY_SIM_WEEKS_PER_YEAR = CITY_SIM_TURNS_PER_YEAR;

const PHASE_LABELS: Record<CityCyclePhase, string> = {
  sign_ups_open: "Sign-ups open",
  primaries: "Primaries",
  generals: "General election",
  legislative: "Legislative session",
};

export function turnPhaseLabel(phase: CityCyclePhase): string {
  return PHASE_LABELS[phase] ?? phase;
}

export function cyclePhaseLabel(phase: CityCyclePhase): string {
  return turnPhaseLabel(phase);
}

export function activeCouncilClassForYear(simYear: number): "A" | "B" {
  return simYear % 2 === 1 ? "A" : "B";
}

export function mayorElectionActiveForYear(simYear: number): boolean {
  return simYear % 2 === 1;
}

export function formatCitySimTurn(status: Pick<CitySimWeekStatus, "simYear">): string {
  return `Year ${status.simYear}`;
}

export function formatCitySimWeek(status: Pick<CitySimWeekStatus, "simYear">): string {
  return formatCitySimTurn(status);
}

/** Biennium N wave 1 = odd sim year (mayor + Class A). Wave 2 = even sim year (Class B). */
export function electionWaveForSimYear(simYear: number): 1 | 2 {
  return simYear % 2 === 1 ? 1 : 2;
}

export function formatElectionWaveLabel(
  status: Pick<CitySimWeekStatus, "bienniumIndex" | "simYear">,
): string {
  const wave = electionWaveForSimYear(status.simYear);
  return `Biennium ${status.bienniumIndex} · Year ${status.simYear} · Wave ${wave}`;
}

export function nextElectionStepHint(
  status: Pick<CitySimWeekStatus, "bienniumIndex" | "simYear" | "cyclePhase">,
): string {
  const wave = electionWaveForSimYear(status.simYear);
  if (status.cyclePhase === "sign_ups_open") {
    return wave === 1
      ? "Open or advance Wave 1 (mayor + W01–W04)"
      : "Open or advance Wave 2 (W05–W07)";
  }
  if (status.cyclePhase === "primaries" || status.cyclePhase === "generals") {
    return `Advance Wave ${wave} races`;
  }
  return "Move to next election wave";
}

export function formatCitySimWeekShort(status: Pick<CitySimWeekStatus, "simYear" | "bienniumIndex">): string {
  return `B${status.bienniumIndex} · Y${status.simYear}`;
}

export function normalizeCampaignPhase(raw: string | null | undefined): "council" | "elections" | null {
  if (raw === "elections") return "elections";
  if (raw === "council" || raw === "congress") return "council";
  return null;
}

export function campaignPhaseLabel(phase: CitySimWeekStatus["campaignPhase"]): string {
  if (phase === "elections") return "Election season";
  if (phase === "council") return "Council session";
  return "City sim";
}

export function isBudgetProposeOpen(
  status: Pick<CitySimWeekStatus, "budgetProposalOpen">,
): boolean {
  return status.budgetProposalOpen;
}

export function isLegislationDraftOpen(
  status: Pick<CitySimWeekStatus, "cyclePhase">,
): boolean {
  return status.cyclePhase === "legislative";
}

export function isOrdinanceProposeOpen(
  status: Pick<CitySimWeekStatus, "ordinancesAllowed" | "cyclePhase" | "budgetPassed" | "budgetEnacted">,
): boolean {
  if (status.ordinancesAllowed) return true;
  return (
    status.cyclePhase === "legislative" && (status.budgetPassed || status.budgetEnacted)
  );
}

export function councilWardElectionClass(wardCode: string): "A" | "B" | null {
  const w = wardCode.trim().toUpperCase();
  if (["W01", "W02", "W03", "W04"].includes(w)) return "A";
  if (["W05", "W06", "W07"].includes(w)) return "B";
  return null;
}

export function cityElectionSeatUpThisYear(
  office: string,
  wardCode: string | null | undefined,
  status: Pick<CitySimWeekStatus, "activeCouncilClass" | "mayorElectionActive">,
): boolean {
  if (office === "mayor") return status.mayorElectionActive;
  if (office === "council_ward") {
    const cls = councilWardElectionClass(String(wardCode ?? ""));
    return cls === status.activeCouncilClass;
  }
  return true;
}

export function cityElectionFilingBlockedMessage(
  office: string,
  _wardCode: string | null | undefined,
  _status: CitySimWeekStatus,
): string | null {
  void office;
  // City races: any player may file for any open seat during the race filing window.
  // Wave/class/sim-year gates are dev-scheduler concerns only, not player eligibility.
  return null;
}

export function phaseChangeBannerMessage(status: CitySimWeekStatus): string | null {
  if (!status.phaseChanged) return null;
  const phase = turnPhaseLabel(status.cyclePhase);
  if (status.cyclePhase === "sign_ups_open") {
    return `New biennium cycle — ${phase}. Mayor may propose the 2-year budget; city election sign-ups are open.`;
  }
  if (status.cyclePhase === "legislative") {
    if (!status.budgetEnacted) {
      return `${phase} began — enact the biennium budget before proposing ordinances.`;
    }
    return `${phase} began — ordinances and council business are open.`;
  }
  return `City phase changed: ${phase}.`;
}
