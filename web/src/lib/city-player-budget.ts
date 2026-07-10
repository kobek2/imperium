/**
 * City budget — department shares indexed to city GDP (office salary pool).
 * Statutory floors climb when GDP grows (more officeholders / higher salaries).
 * Revenue is separate: low taxes + maintained floors → deficit/debt tradeoff.
 */

import type { CityFiscalDepartmentKey } from "@/lib/city-fiscal-data";
import { CITY_FISCAL_DEPARTMENT_KEYS } from "@/lib/city-fiscal-data";

/** Default share of city GDP per department (sums to 1). */
export const DEPT_REVENUE_SHARE: Record<CityFiscalDepartmentKey, number> = {
  finance: 0.08,
  police: 0.35,
  public_works: 0.28,
  parks: 0.18,
  planning: 0.11,
};

export const DEPT_MINIMUM_SHARE_FRACTION = 0.75;

/** Default levy on annualized qualifying commercial ledger volume. */
export const DEFAULT_BUSINESS_TAX_RATE_PCT = 1.5;

export function deptShareMillions(
  key: CityFiscalDepartmentKey,
  totalRevenueMillions: number,
): number {
  return totalRevenueMillions * DEPT_REVENUE_SHARE[key];
}

export function deptMinimumShareMillions(
  key: CityFiscalDepartmentKey,
  totalRevenueMillions: number,
): number {
  return deptShareMillions(key, totalRevenueMillions) * DEPT_MINIMUM_SHARE_FRACTION;
}

export function deptDefaultSharePercent(key: CityFiscalDepartmentKey): number {
  return DEPT_REVENUE_SHARE[key] * 100;
}

export function deptMinimumSharePercent(key: CityFiscalDepartmentKey): number {
  return DEPT_REVENUE_SHARE[key] * DEPT_MINIMUM_SHARE_FRACTION * 100;
}

export function deptDefaultGdpSharePercent(key: CityFiscalDepartmentKey): number {
  return deptDefaultSharePercent(key);
}

export function deptMinimumGdpSharePercent(key: CityFiscalDepartmentKey): number {
  return deptMinimumSharePercent(key);
}

export function annualGdpMillions(annualGdpUsd: number): number {
  return annualGdpUsd / 1_000_000;
}

export function roundBudgetMillions(value: number): number {
  if (value >= 10) return Math.round(value * 10) / 10;
  if (value >= 1) return Math.round(value * 100) / 100;
  return Math.round(value * 1000) / 1000;
}

/** Statutory floor = 75% of default dept share × annual city GDP. */
export function deptMinimumMillionsFromGdp(
  key: CityFiscalDepartmentKey,
  annualGdpUsd: number,
): number {
  if (annualGdpUsd <= 0) return 0;
  return roundBudgetMillions(
    annualGdpMillions(annualGdpUsd) * DEPT_REVENUE_SHARE[key] * DEPT_MINIMUM_SHARE_FRACTION,
  );
}

export function totalMinimumSpendMillionsFromGdp(annualGdpUsd: number): number {
  if (annualGdpUsd <= 0) return 0;
  return roundBudgetMillions(
    CITY_FISCAL_DEPARTMENT_KEYS.reduce(
      (sum, key) => sum + deptMinimumMillionsFromGdp(key, annualGdpUsd),
      0,
    ),
  );
}

export function allocationMillionsFromGdpSharePercent(
  gdpSharePercent: number,
  annualGdpUsd: number,
): number {
  if (annualGdpUsd <= 0) return 0;
  return roundBudgetMillions((gdpSharePercent / 100) * annualGdpMillions(annualGdpUsd));
}

export function gdpSharePercentFromAllocationMillions(
  allocationMillions: number,
  annualGdpUsd: number,
): number {
  if (annualGdpUsd <= 0) return 0;
  return (allocationMillions / annualGdpMillions(annualGdpUsd)) * 100;
}

export function deptMaxGdpSharePercent(key: CityFiscalDepartmentKey): number {
  return Math.max(deptMinimumGdpSharePercent(key), deptDefaultGdpSharePercent(key) * 5);
}

export function snapAllocationToGdpShareGrid(
  allocationMillions: number,
  annualGdpUsd: number,
  key: CityFiscalDepartmentKey,
): number {
  if (annualGdpUsd <= 0) return 0;
  const pct = gdpSharePercentFromAllocationMillions(allocationMillions, annualGdpUsd);
  const snapped = snapSharePercent(
    pct,
    deptMinimumGdpSharePercent(key),
    deptMaxGdpSharePercent(key),
  );
  return allocationMillionsFromGdpSharePercent(snapped, annualGdpUsd);
}

/** Slider step as share of GDP (half-percent). */
export function playerBudgetShareStepPercent(): number {
  return 0.5;
}

export function sharePercentFromAllocationMillions(
  allocationMillions: number,
  totalRevenueMillions: number,
): number {
  if (totalRevenueMillions <= 0) return 0;
  return (allocationMillions / totalRevenueMillions) * 100;
}

export function allocationMillionsFromSharePercent(
  sharePercent: number,
  totalRevenueMillions: number,
): number {
  return roundBudgetMillions((sharePercent / 100) * totalRevenueMillions);
}

export function snapSharePercent(
  sharePercent: number,
  minSharePercent: number,
  maxSharePercent: number,
): number {
  const step = playerBudgetShareStepPercent();
  const minPct = Math.ceil(minSharePercent / step) * step;
  const maxPct = Math.floor(maxSharePercent / step) * step;
  const snapped = Math.round(sharePercent / step) * step;
  return Math.min(maxPct, Math.max(minPct, snapped));
}

export function snapAllocationToShareGrid(
  allocationMillions: number,
  totalRevenueMillions: number,
  key: CityFiscalDepartmentKey,
): number {
  if (totalRevenueMillions <= 0) return 0;
  const pct = sharePercentFromAllocationMillions(allocationMillions, totalRevenueMillions);
  const snapped = snapSharePercent(
    pct,
    deptMinimumSharePercent(key),
    deptMaxSharePercent(key),
  );
  return allocationMillionsFromSharePercent(snapped, totalRevenueMillions);
}

export function deptMaxSharePercent(key: CityFiscalDepartmentKey): number {
  return Math.min(100, deptDefaultSharePercent(key) * 2.5);
}

export function defaultPlayerBudgetAllocationsFromGdp(
  annualGdpUsd: number,
): Record<CityFiscalDepartmentKey, number> {
  const out = {} as Record<CityFiscalDepartmentKey, number>;
  for (const key of CITY_FISCAL_DEPARTMENT_KEYS) {
    out[key] = allocationMillionsFromGdpSharePercent(deptDefaultGdpSharePercent(key), annualGdpUsd);
  }
  return out;
}

export function defaultPlayerBudgetAllocations(
  totalRevenueMillions: number,
): Record<CityFiscalDepartmentKey, number> {
  const out = {} as Record<CityFiscalDepartmentKey, number>;
  for (const key of CITY_FISCAL_DEPARTMENT_KEYS) {
    out[key] = allocationMillionsFromSharePercent(deptDefaultSharePercent(key), totalRevenueMillions);
  }
  return out;
}

/** True when stored NYC-scale billions dwarf player-economy revenue. */
export function budgetsMisalignedWithRevenue(
  totalExpenditureMillions: number,
  totalRevenueMillions: number,
): boolean {
  if (totalRevenueMillions <= 0) return totalExpenditureMillions > 1;
  return totalExpenditureMillions > totalRevenueMillions * 2.5;
}

export function computePlayerBusinessTaxMillions(
  annualizedCommercialVolumeUsd: number,
  businessTaxRatePct: number,
): number {
  if (annualizedCommercialVolumeUsd <= 0 || businessTaxRatePct <= 0) return 0;
  return (annualizedCommercialVolumeUsd * (businessTaxRatePct / 100)) / 1_000_000;
}

/** Deficit triggers supermajority when deeper than 15% of projected revenue. */
export function budgetRequiresSupermajority(
  deficitMillions: number,
  totalRevenueMillions: number,
  revenueSource: "player" | "macro",
): boolean {
  if (revenueSource === "player" && totalRevenueMillions > 0) {
    return deficitMillions < -(totalRevenueMillions * 0.15);
  }
  return deficitMillions < -800;
}

export function formatBudgetMillions(value: number): string {
  if (value === 0) return "$0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}B`;
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}M`;
  if (abs >= 0.001) return `${sign}$${(abs * 1000).toFixed(0)}K`;
  return `${sign}$${(abs * 1_000_000).toFixed(0)}`;
}
