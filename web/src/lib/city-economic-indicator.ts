/**
 * Derived economic indicator — replaces the abstract propagated 0–100 economy score.
 * Dollar inputs are authoritative; graph edges that targeted economy now adjust economicPressure.
 */

export { BUSINESS_TAX_GROWTH_CONSTANT } from "@/lib/city-player-business-activity";

export {
  CITY_MAYOR_SALARY_PER_TURN_USD,
  CITY_COUNCIL_SALARY_PER_TURN_USD,
} from "@/lib/city-office-salary-tax";
export { CITY_SIM_TURNS_PER_YEAR } from "@/lib/city-sim-week";
import {
  CITY_MAYOR_SALARY_PER_TURN_USD,
  CITY_COUNCIL_SALARY_PER_TURN_USD,
  CITY_OFFICE_SALARY_TURN_HOURS,
} from "@/lib/city-office-salary-tax";

/** Per sim turn while holding office (24 wall-clock hours). */
export const CITY_OFFICE_SALARY_PER_TURN_USD: Record<"mayor" | "council_member", number> = {
  mayor: CITY_MAYOR_SALARY_PER_TURN_USD,
  council_member: CITY_COUNCIL_SALARY_PER_TURN_USD,
};

export const OFFICE_SALARY_COLLECTION_WINDOW_MS = CITY_OFFICE_SALARY_TURN_HOURS * 60 * 60 * 1000;

export type CityEconomicInputs = {
  population: number;
  businessTaxRevenueMillions: number;
  salaryPoolMillions: number;
  /** Accumulated policy-graph pressure (formerly direct economy deltas). */
  economicPressure?: number;
};

export type CityEconomicFiscalContext = {
  population: number;
  businessTaxRevenueMillions: number;
  salaryPoolMillions: number;
};

function clampIndicator(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** City income tax on a collected office salary (blended bracket rates). */
export function computeSalaryIncomeTaxUsd(
  collectedUsd: number,
  enabled: boolean,
  lowPct: number,
  midPct: number,
  highPct: number,
): number {
  if (!enabled || collectedUsd <= 0) return 0;
  const blendedRate = (0.4 * lowPct + 0.4 * midPct + 0.2 * highPct) / 100;
  return Math.round(collectedUsd * blendedRate * 100) / 100;
}

/**
 * 0–100 derived indicator for the metrics graph `economy` node.
 * Weights: business activity, salary pool activity, policy pressure.
 */
export function computeEconomicIndicator(input: CityEconomicInputs): number {
  const pop = Math.max(1, input.population);
  const businessPerCapita = (input.businessTaxRevenueMillions * 1_000_000) / pop;
  const salaryPerCapita = (input.salaryPoolMillions * 1_000_000) / pop;
  const pressure = input.economicPressure ?? 0;

  // Tunable baselines for NYC-scale city (millions in revenue → per-capita annual proxy).
  const businessScore = clampIndicator(42 + (businessPerCapita - 90) / 6);
  const salaryScore = clampIndicator(38 + (salaryPerCapita - 0.15) / 0.04);
  const pressureScore = clampIndicator(50 + pressure);

  return clampIndicator(0.5 * businessScore + 0.3 * salaryScore + 0.2 * pressureScore);
}

export function economicFiscalContextFromSnapshot(input: {
  population: number;
  businessTaxRevenueMillions: number;
  officeSalaryPoolMillions: number;
}): CityEconomicFiscalContext {
  return {
    population: input.population,
    businessTaxRevenueMillions: input.businessTaxRevenueMillions,
    salaryPoolMillions: input.officeSalaryPoolMillions,
  };
}

export function totalOfficeSalaryPoolMillions(accruedUsdTotal: number): number {
  return accruedUsdTotal / 1_000_000;
}

export {
  BUSINESS_TAX_ACTIVITY_WINDOW_DAYS,
  BUSINESS_TAX_MIN_ACTIVE_PLAYERS,
  BUSINESS_TAX_MIN_ANNUALIZED_VOLUME_USD,
  BUSINESS_TAX_MIN_QUALIFYING_TRANSACTIONS,
  QUALIFYING_BUSINESS_LEDGER_KINDS,
  computeBusinessTaxRevenueMillions,
  computePlaceholderBusinessTaxRevenueMillions,
  computeActivityBusinessTaxRevenueMillions,
  isMeaningfulBusinessActivity,
  logBusinessTaxRevenueComparison,
  resolveBusinessTaxRevenueMillions,
  type BusinessTaxRevenueResolution,
  type PlayerBusinessActivitySnapshot,
  type QualifyingBusinessLedgerKind,
} from "@/lib/city-player-business-activity";
