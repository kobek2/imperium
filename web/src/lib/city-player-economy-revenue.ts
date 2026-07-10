/**
 * City budget revenue from player economy (wallets + wage ledger), with macro fallback.
 */

import {
  BUSINESS_TAX_ACTIVITY_WINDOW_DAYS,
  type PlayerBusinessActivitySnapshot,
} from "@/lib/city-player-business-activity";
import {
  computeOfficeSalaryIncomeTaxMillions,
  type CityOfficeSalaryTaxBase,
} from "@/lib/city-office-salary-tax";
import { DEFAULT_BUSINESS_TAX_RATE_PCT } from "@/lib/city-player-budget";

export { DEFAULT_BUSINESS_TAX_RATE_PCT };

export const CITY_FISCAL_ACTIVITY_WINDOW_DAYS = BUSINESS_TAX_ACTIVITY_WINDOW_DAYS;

/** Wallet balances treated as assessable property proxy (not 100% — liquid wealth). */
export const PROPERTY_TAX_ASSESSED_WALLET_FRACTION = 0.25;

/** Intergov aid scales with player GDP vs this reference wallet sum ($500M). */
export const INTERGOV_REFERENCE_WALLET_GDP_USD = 500_000_000;
export const INTERGOV_SCALE_MIN = 0.05;
export const INTERGOV_SCALE_MAX = 1;

/** Player-economy budgets exclude configured macro intergov aid. */
export const PLAYER_ECONOMY_INTERGOV_AID_MILLIONS = 0;

export const PLAYER_ECONOMY_MIN_WALLET_PLAYERS = 2;
export const PLAYER_ECONOMY_MIN_WALLET_SUM_USD = 50_000;

export const WAGE_INCOME_LEDGER_KINDS = ["hourly_income", "income_collect"] as const;

export type PlayerEconomySnapshot = {
  windowDays: number;
  walletBalanceSumUsd: number;
  walletPlayerCount: number;
  annualizedWageUsd: number;
  wagePlayerCount: number;
  wageTransactions: number;
  businessActivity: PlayerBusinessActivitySnapshot;
};

export type CityRevenueBreakdown = {
  source: "player" | "macro";
  propertyTaxMillions: number;
  wageIncomeTaxMillions: number;
  businessTaxMillions: number;
  salaryTaxMillions: number;
  cannabisSalesTaxMillions: number;
  localSalesTaxMillions: number;
  intergovernmentalAidMillions: number;
  totalRevenueMillions: number;
};

export function intergovernmentalAidScale(walletBalanceSumUsd: number): number {
  if (walletBalanceSumUsd <= 0) return INTERGOV_SCALE_MIN;
  const raw = Math.sqrt(walletBalanceSumUsd / INTERGOV_REFERENCE_WALLET_GDP_USD);
  return Math.max(INTERGOV_SCALE_MIN, Math.min(INTERGOV_SCALE_MAX, raw));
}

export function scaledIntergovernmentalAidMillions(
  configuredAidMillions: number,
  walletBalanceSumUsd: number,
): number {
  return configuredAidMillions * intergovernmentalAidScale(walletBalanceSumUsd);
}

export function hasOfficeSalaryTaxBase(base: CityOfficeSalaryTaxBase | null | undefined): boolean {
  if (!base) return false;
  return base.mayorCount + base.councilCount > 0;
}

export function computeMacroPropertyTaxRevenueMillions(
  population: number,
  avgHouseholdIncome: number,
  propertyTaxRatePct: number,
  economyIndex: number,
): number {
  if (population <= 0 || propertyTaxRatePct <= 0) return 0;
  const economyMultiplier = economyIndex > 0 ? economyIndex / 100 : 1;
  const assessedBase = population * avgHouseholdIncome * 0.3 * economyMultiplier;
  return (assessedBase * (propertyTaxRatePct / 100)) / 1_000_000;
}

export function computeMacroWageIncomeTaxRevenueMillions(
  population: number,
  avgHouseholdIncome: number,
  enabled: boolean,
  lowPct: number,
  midPct: number,
  highPct: number,
  economyIndex: number,
): number {
  if (!enabled || population <= 0) return 0;
  const economyMultiplier = economyIndex > 0 ? economyIndex / 100 : 1;
  const blendedRate = (0.4 * lowPct + 0.4 * midPct + 0.2 * highPct) / 100;
  const taxableBase = population * avgHouseholdIncome * economyMultiplier;
  return (taxableBase * blendedRate) / 1_000_000;
}

export function computePlayerPropertyTaxRevenueMillions(
  walletBalanceSumUsd: number,
  propertyTaxRatePct: number,
  economyIndex: number,
): number {
  if (walletBalanceSumUsd <= 0 || propertyTaxRatePct <= 0) return 0;
  const economyMultiplier = economyIndex > 0 ? economyIndex / 100 : 1;
  const assessedBase = walletBalanceSumUsd * PROPERTY_TAX_ASSESSED_WALLET_FRACTION * economyMultiplier;
  return (assessedBase * (propertyTaxRatePct / 100)) / 1_000_000;
}

export function computePlayerWageIncomeTaxRevenueMillions(
  annualizedWageUsd: number,
  enabled: boolean,
  lowPct: number,
  midPct: number,
  highPct: number,
  economyIndex: number,
): number {
  if (!enabled || annualizedWageUsd <= 0) return 0;
  const economyMultiplier = economyIndex > 0 ? economyIndex / 100 : 1;
  const blendedRate = (0.4 * lowPct + 0.4 * midPct + 0.2 * highPct) / 100;
  return (annualizedWageUsd * economyMultiplier * blendedRate) / 1_000_000;
}

export function resolveCityRevenueBreakdown(input: {
  population: number;
  avgHouseholdIncome: number;
  economyIndex: number;
  propertyTaxRatePct: number;
  incomeTaxEnabled: boolean;
  incomeTaxFlat: boolean;
  incomeTaxLowPct: number;
  incomeTaxMidPct: number;
  incomeTaxHighPct: number;
  businessTaxRatePct: number;
  configuredIntergovernmentalAidMillions: number;
  businessTaxRevenueMillions: number;
  salaryTaxRevenueMillions: number;
  cannabisSalesTaxRevenueMillions?: number;
  localSalesTaxRevenueMillions?: number;
  playerEconomy: PlayerEconomySnapshot | null;
  officeSalaryBase: CityOfficeSalaryTaxBase | null;
}): CityRevenueBreakdown {
  const useOfficeSalary = hasOfficeSalaryTaxBase(input.officeSalaryBase);

  if (useOfficeSalary && input.officeSalaryBase) {
    const wageIncomeTaxMillions = computeOfficeSalaryIncomeTaxMillions({
      base: input.officeSalaryBase,
      enabled: input.incomeTaxEnabled,
      flatMode: input.incomeTaxFlat,
      lowPct: input.incomeTaxLowPct,
      midPct: input.incomeTaxMidPct,
      highPct: input.incomeTaxHighPct,
    });
    const cannabisSalesTaxMillions = Number(input.cannabisSalesTaxRevenueMillions ?? 0);
    const localSalesTaxMillions = Number(input.localSalesTaxRevenueMillions ?? 0);

    return {
      source: "player",
      propertyTaxMillions: 0,
      wageIncomeTaxMillions,
      businessTaxMillions: 0,
      salaryTaxMillions: 0,
      cannabisSalesTaxMillions,
      localSalesTaxMillions,
      intergovernmentalAidMillions: 0,
      totalRevenueMillions: wageIncomeTaxMillions + cannabisSalesTaxMillions + localSalesTaxMillions,
    };
  }

  const salaryTaxMillions = input.salaryTaxRevenueMillions;
  const cannabisSalesTaxMillions = Number(input.cannabisSalesTaxRevenueMillions ?? 0);
  const localSalesTaxMillions = Number(input.localSalesTaxRevenueMillions ?? 0);
  const pe = input.playerEconomy;

  let propertyTaxMillions: number;
  let wageIncomeTaxMillions: number;
  let businessTaxMillions: number;
  let intergovernmentalAidMillions: number;
  let source: "player" | "macro";

  source = "macro";
  businessTaxMillions = input.businessTaxRevenueMillions;
  propertyTaxMillions = computeMacroPropertyTaxRevenueMillions(
    input.population,
    input.avgHouseholdIncome,
    input.propertyTaxRatePct,
    input.economyIndex,
  );
  wageIncomeTaxMillions = computeMacroWageIncomeTaxRevenueMillions(
    input.population,
    input.avgHouseholdIncome,
    input.incomeTaxEnabled,
    input.incomeTaxLowPct,
    input.incomeTaxMidPct,
    input.incomeTaxHighPct,
    input.economyIndex,
  );
  intergovernmentalAidMillions = input.configuredIntergovernmentalAidMillions;

  const totalRevenueMillions =
    propertyTaxMillions +
    wageIncomeTaxMillions +
    businessTaxMillions +
    salaryTaxMillions +
    cannabisSalesTaxMillions +
    localSalesTaxMillions +
    intergovernmentalAidMillions;

  return {
    source,
    propertyTaxMillions,
    wageIncomeTaxMillions,
    businessTaxMillions,
    salaryTaxMillions,
    cannabisSalesTaxMillions,
    localSalesTaxMillions,
    intergovernmentalAidMillions,
    totalRevenueMillions,
  };
}

export function logCityRevenueBreakdown(
  breakdown: CityRevenueBreakdown,
  officeSalaryBase: CityOfficeSalaryTaxBase | null,
): void {
  if (process.env.NODE_ENV === "production") return;
  // eslint-disable-next-line no-console
  console.info("[city-budget-revenue]", {
    source: breakdown.source,
    totalRevenueMillions: Number(breakdown.totalRevenueMillions.toFixed(2)),
    wageIncomeTaxMillions: Number(breakdown.wageIncomeTaxMillions.toFixed(2)),
    mayorCount: officeSalaryBase?.mayorCount ?? null,
    councilCount: officeSalaryBase?.councilCount ?? null,
    turnsPerYear: officeSalaryBase?.turnsPerYear ?? null,
  });
}
