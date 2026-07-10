/**
 * City budget taxes office salary income only (mayor + council).
 * Pay accrues linearly over each 24-hour collection window (collect-or-forfeit).
 */

import { CITY_BUDGET_CYCLE_YEARS, CITY_SIM_TURNS_PER_YEAR } from "@/lib/city-sim-week";

/** Wall-clock hours per sim turn (matches salary accrual window). */
export const CITY_OFFICE_SALARY_TURN_HOURS = 24;

export const CITY_MAYOR_SALARY_PER_TURN_USD = 150_000;
export const CITY_COUNCIL_SALARY_PER_TURN_USD = 100_000;

export const CITY_INCOME_TAX_BRACKET_LOW_MAX_USD = 50_000;
export const CITY_INCOME_TAX_BRACKET_MID_MAX_USD = 150_000;

export type OfficeSalaryHolder = {
  userId: string;
  name: string;
  roleKey: "mayor" | "council_member";
};

export type CityOfficeSalaryTaxBase = {
  turnsPerYear: number;
  mayorCount: number;
  councilCount: number;
  mayorSalaryPerTurnUsd: number;
  councilSalaryPerTurnUsd: number;
  holders: OfficeSalaryHolder[];
};

export function annualSalaryPerMayorUsd(base: Pick<CityOfficeSalaryTaxBase, "mayorSalaryPerTurnUsd" | "turnsPerYear">): number {
  return base.mayorSalaryPerTurnUsd * base.turnsPerYear;
}

export function annualSalaryPerCouncilUsd(
  base: Pick<CityOfficeSalaryTaxBase, "councilSalaryPerTurnUsd" | "turnsPerYear">,
): number {
  return base.councilSalaryPerTurnUsd * base.turnsPerYear;
}

export function annualSalaryForHolder(
  holder: OfficeSalaryHolder,
  base: Pick<CityOfficeSalaryTaxBase, "mayorSalaryPerTurnUsd" | "councilSalaryPerTurnUsd" | "turnsPerYear">,
): number {
  const perTurn =
    holder.roleKey === "mayor" ? base.mayorSalaryPerTurnUsd : base.councilSalaryPerTurnUsd;
  return perTurn * base.turnsPerYear;
}

export function totalAnnualOfficeSalaryIncomeUsd(base: CityOfficeSalaryTaxBase): number {
  return base.holders.reduce((sum, holder) => sum + annualSalaryForHolder(holder, base), 0);
}

/** Annual GDP proxy from seated officeholders (per-window pay × collection windows/year for budget). */
export function projectedAnnualCityGdpUsd(base: CityOfficeSalaryTaxBase): number {
  return totalAnnualOfficeSalaryIncomeUsd(base);
}

/** Biennial GDP for 2-year budget cycle (= 2× annual projection). */
export function projectedBiennialCityGdpUsd(base: CityOfficeSalaryTaxBase): number {
  return projectedAnnualCityGdpUsd(base) * CITY_BUDGET_CYCLE_YEARS;
}

export { CITY_BUDGET_CYCLE_YEARS };

export function computeMarginalIncomeTaxUsd(
  annualIncomeUsd: number,
  lowPct: number,
  midPct: number,
  highPct: number,
): number {
  if (annualIncomeUsd <= 0) return 0;
  const lowBand = Math.min(annualIncomeUsd, CITY_INCOME_TAX_BRACKET_LOW_MAX_USD);
  const midBand = Math.min(
    Math.max(annualIncomeUsd - CITY_INCOME_TAX_BRACKET_LOW_MAX_USD, 0),
    CITY_INCOME_TAX_BRACKET_MID_MAX_USD - CITY_INCOME_TAX_BRACKET_LOW_MAX_USD,
  );
  const highBand = Math.max(annualIncomeUsd - CITY_INCOME_TAX_BRACKET_MID_MAX_USD, 0);
  return (
    lowBand * (lowPct / 100) +
    midBand * (midPct / 100) +
    highBand * (highPct / 100)
  );
}

export function computeFlatIncomeTaxUsd(annualIncomeUsd: number, flatPct: number): number {
  if (annualIncomeUsd <= 0 || flatPct <= 0) return 0;
  return annualIncomeUsd * (flatPct / 100);
}

export function computeOfficeSalaryIncomeTaxUsd(input: {
  base: CityOfficeSalaryTaxBase;
  enabled: boolean;
  flatMode: boolean;
  lowPct: number;
  midPct: number;
  highPct: number;
}): number {
  if (!input.enabled || input.base.holders.length === 0) return 0;

  let taxUsd = 0;
  for (const holder of input.base.holders) {
    const annual = annualSalaryForHolder(holder, input.base);
    if (input.flatMode) {
      taxUsd += computeFlatIncomeTaxUsd(annual, input.midPct);
    } else {
      taxUsd += computeMarginalIncomeTaxUsd(annual, input.lowPct, input.midPct, input.highPct);
    }
  }
  return taxUsd;
}

export function computeOfficeSalaryIncomeTaxMillions(
  input: Parameters<typeof computeOfficeSalaryIncomeTaxUsd>[0],
): number {
  return computeOfficeSalaryIncomeTaxUsd(input) / 1_000_000;
}

export function defaultOfficeSalaryTaxBase(holders: OfficeSalaryHolder[]): CityOfficeSalaryTaxBase {
  const mayorCount = holders.filter((h) => h.roleKey === "mayor").length;
  const councilCount = holders.filter((h) => h.roleKey === "council_member").length;
  return {
    turnsPerYear: CITY_SIM_TURNS_PER_YEAR,
    mayorCount,
    councilCount,
    mayorSalaryPerTurnUsd: CITY_MAYOR_SALARY_PER_TURN_USD,
    councilSalaryPerTurnUsd: CITY_COUNCIL_SALARY_PER_TURN_USD,
    holders,
  };
}

export function describeOfficeSalaryTaxBase(base: CityOfficeSalaryTaxBase): string {
  if (base.holders.length === 0) return "No seated player officeholders";
  return base.holders
    .map((holder) => {
      const annual = annualSalaryForHolder(holder, base);
      const perTurn = annual / base.turnsPerYear;
      const role = holder.roleKey === "mayor" ? "Mayor" : "Council";
      return `${holder.name} (${role}: ${formatUsd(perTurn)}/${CITY_OFFICE_SALARY_TURN_HOURS}h turn × ${base.turnsPerYear} = ${formatUsd(annual)})`;
    })
    .join(" · ");
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
