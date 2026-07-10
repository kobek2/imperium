import type { SupabaseClient } from "@supabase/supabase-js";
import type { CitySimEffectEvent } from "@/lib/city-sim-effects";
import { NYC_CITY_CODE } from "@/lib/city";
import { deptMinimumMillions as macroDeptMinimumMillions } from "@/lib/city-department-budget";
import {
  budgetRequiresSupermajority,
  deptMinimumMillionsFromGdp,
  deptMinimumShareMillions,
  formatBudgetMillions,
} from "@/lib/city-player-budget";
import { DEFAULT_BUSINESS_TAX_RATE_PCT } from "@/lib/city-player-economy-revenue";
import {
  resolveCityRevenueBreakdown,
  type CityRevenueBreakdown,
  type PlayerEconomySnapshot,
  hasOfficeSalaryTaxBase,
} from "@/lib/city-player-economy-revenue";
import type { CityOfficeSalaryTaxBase } from "@/lib/city-office-salary-tax";
import { totalAnnualOfficeSalaryIncomeUsd, projectedBiennialCityGdpUsd } from "@/lib/city-office-salary-tax";
import { loadCityOfficeSalaryTaxBase } from "@/lib/city-office-salary-tax-data";
import { refreshCityBusinessTaxRevenue } from "@/lib/city-player-business-activity-data";
import { logCityRevenueBreakdown } from "@/lib/city-player-economy-revenue";
import { CITY_BUDGET_CYCLE_YEARS } from "@/lib/city-sim-week";

export const CITY_FISCAL_DEPARTMENT_KEYS = [
  "finance",
  "police",
  "public_works",
  "parks",
  "planning",
] as const;

export type CityFiscalDepartmentKey = (typeof CITY_FISCAL_DEPARTMENT_KEYS)[number];

export type CityFiscalDepartmentAllocation = {
  departmentKey: CityFiscalDepartmentKey;
  amountMillions: number;
  minimumRequiredMillions?: number;
};

export type CityFiscalSnapshot = {
  cityCode: string;
  population: number;
  avgHouseholdIncome: number;
  economyIndex: number;
  propertyTaxRatePct: number;
  businessTaxRatePct: number;
  incomeTaxEnabled: boolean;
  incomeTaxFlat: boolean;
  incomeTaxLowPct: number;
  incomeTaxMidPct: number;
  incomeTaxHighPct: number;
  intergovernmentalAidMillions: number;
  treasuryBalance: number;
  fiscalYear: number;
  businessTaxRevenueMillions: number;
  salaryTaxRevenueMillions: number;
  cannabisSalesTaxRatePct: number;
  cannabisSalesTaxRevenueMillions: number;
  localSalesTaxRatePct: number;
  localSalesTaxRevenueMillions: number;
  officeSalaryPoolMillions: number;
  publicSafety: number;
  educationQuality: number;
  housingAffordability: number;
  businessClimate: number;
  mayorApproval: number;
  mayorElectoralApproval: number;
  updatedAt: string;
  departments: CityFiscalDepartmentAllocation[];
  recentEffects: CitySimEffectEvent[];
  playerEconomy?: PlayerEconomySnapshot | null;
  officeSalaryBase?: CityOfficeSalaryTaxBase | null;
  revenueBreakdown?: CityRevenueBreakdown;
};

export type CityFiscalComputed = {
  propertyTaxRevenueMillions: number;
  wageIncomeTaxRevenueMillions: number;
  incomeTaxRevenueMillions: number;
  businessTaxRevenueMillions: number;
  salaryTaxRevenueMillions: number;
  cannabisSalesTaxRevenueMillions: number;
  localSalesTaxRevenueMillions: number;
  intergovernmentalAidMillions: number;
  totalTaxRevenueMillions: number;
  totalRevenueMillions: number;
  totalExpenditureMillions: number;
  annualSurplusDeficitMillions: number;
  projectedTreasuryMillions: number;
  requiresSupermajority: boolean;
  revenueSource: "player" | "macro";
};

const DEPT_LABELS: Record<CityFiscalDepartmentKey, string> = {
  finance: "Finance",
  police: "Police",
  public_works: "Public Works",
  parks: "Parks & Recreation",
  planning: "City Planning",
};

export function cityFiscalDepartmentLabel(key: CityFiscalDepartmentKey): string {
  return DEPT_LABELS[key];
}

/** @deprecated Use computePlayerPropertyTaxRevenueMillions — macro fallback only. */
export function computePropertyTaxRevenueMillions(
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

/** @deprecated Use computePlayerWageIncomeTaxRevenueMillions — macro fallback only. */
export function computeIncomeTaxRevenueMillions(
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

export function computeCityFiscalTotals(snapshot: CityFiscalSnapshot): CityFiscalComputed {
  const businessTaxRatePct = snapshot.businessTaxRatePct || DEFAULT_BUSINESS_TAX_RATE_PCT;

  let breakdown = resolveCityRevenueBreakdown({
    population: snapshot.population,
    avgHouseholdIncome: snapshot.avgHouseholdIncome,
    economyIndex: snapshot.economyIndex,
    propertyTaxRatePct: snapshot.propertyTaxRatePct,
    businessTaxRatePct,
    incomeTaxEnabled: snapshot.incomeTaxEnabled,
    incomeTaxFlat: snapshot.incomeTaxFlat,
    incomeTaxLowPct: snapshot.incomeTaxLowPct,
    incomeTaxMidPct: snapshot.incomeTaxMidPct,
    incomeTaxHighPct: snapshot.incomeTaxHighPct,
    configuredIntergovernmentalAidMillions: snapshot.intergovernmentalAidMillions,
    businessTaxRevenueMillions: snapshot.businessTaxRevenueMillions,
    salaryTaxRevenueMillions: snapshot.salaryTaxRevenueMillions,
    cannabisSalesTaxRevenueMillions: snapshot.cannabisSalesTaxRevenueMillions,
    localSalesTaxRevenueMillions: snapshot.localSalesTaxRevenueMillions,
    playerEconomy: snapshot.playerEconomy ?? null,
    officeSalaryBase: snapshot.officeSalaryBase ?? null,
  });

  // Player office-salary revenue is computed per year; biennium budgets use 2× annual collections.
  if (breakdown.source === "player" && hasOfficeSalaryTaxBase(snapshot.officeSalaryBase)) {
    breakdown = scaleRevenueBreakdownToBiennium(breakdown);
  }

  const totalExpenditureMillions = snapshot.departments.reduce(
    (sum, d) => sum + d.amountMillions,
    0,
  );
  const annualSurplusDeficitMillions = breakdown.totalRevenueMillions - totalExpenditureMillions;
  const projectedTreasuryMillions = snapshot.treasuryBalance + annualSurplusDeficitMillions;

  return {
    propertyTaxRevenueMillions: breakdown.propertyTaxMillions,
    wageIncomeTaxRevenueMillions: breakdown.wageIncomeTaxMillions,
    incomeTaxRevenueMillions: breakdown.wageIncomeTaxMillions,
    businessTaxRevenueMillions: breakdown.businessTaxMillions,
    salaryTaxRevenueMillions: breakdown.salaryTaxMillions,
    cannabisSalesTaxRevenueMillions: breakdown.cannabisSalesTaxMillions,
    localSalesTaxRevenueMillions: breakdown.localSalesTaxMillions,
    intergovernmentalAidMillions: breakdown.intergovernmentalAidMillions,
    totalTaxRevenueMillions:
      breakdown.propertyTaxMillions +
      breakdown.wageIncomeTaxMillions +
      breakdown.businessTaxMillions +
      breakdown.salaryTaxMillions +
      breakdown.cannabisSalesTaxMillions +
      breakdown.localSalesTaxMillions,
    totalRevenueMillions: breakdown.totalRevenueMillions,
    totalExpenditureMillions,
    annualSurplusDeficitMillions,
    projectedTreasuryMillions,
    requiresSupermajority: budgetRequiresSupermajority(
      annualSurplusDeficitMillions,
      breakdown.totalRevenueMillions,
      breakdown.source,
    ),
    revenueSource: breakdown.source,
  };
}

export function departmentMinimumMillions(
  key: CityFiscalDepartmentKey,
  snapshot: CityFiscalSnapshot,
  totalRevenueMillions: number,
  revenueSource: "player" | "macro",
): number {
  if (revenueSource === "player") {
    const gdpUsd = snapshot.officeSalaryBase
      ? projectedBiennialCityGdpUsd(snapshot.officeSalaryBase)
      : 0;
    if (gdpUsd > 0) {
      return deptMinimumMillionsFromGdp(key, gdpUsd);
    }
    if (totalRevenueMillions > 0) {
      return deptMinimumShareMillions(key, totalRevenueMillions);
    }
  }
  return macroDeptMinimumMillions(key);
}

function scaleRevenueBreakdownToBiennium(breakdown: CityRevenueBreakdown): CityRevenueBreakdown {
  const scale = CITY_BUDGET_CYCLE_YEARS;
  return {
    ...breakdown,
    propertyTaxMillions: breakdown.propertyTaxMillions * scale,
    wageIncomeTaxMillions: breakdown.wageIncomeTaxMillions * scale,
    businessTaxMillions: breakdown.businessTaxMillions * scale,
    salaryTaxMillions: breakdown.salaryTaxMillions * scale,
    cannabisSalesTaxMillions: breakdown.cannabisSalesTaxMillions * scale,
    localSalesTaxMillions: breakdown.localSalesTaxMillions * scale,
    intergovernmentalAidMillions: breakdown.intergovernmentalAidMillions * scale,
    totalRevenueMillions: breakdown.totalRevenueMillions * scale,
  };
}

/** @deprecated Use formatBudgetMillions for player-scale amounts. */
export const formatFiscalMillions = formatBudgetMillions;

export function emptyCityFiscalSnapshot(cityCode = NYC_CITY_CODE): CityFiscalSnapshot {
  return {
    cityCode,
    population: 0,
    avgHouseholdIncome: 0,
    economyIndex: 0,
    propertyTaxRatePct: 0,
    businessTaxRatePct: DEFAULT_BUSINESS_TAX_RATE_PCT,
    incomeTaxEnabled: false,
    incomeTaxFlat: true,
    incomeTaxLowPct: 0,
    incomeTaxMidPct: 0,
    incomeTaxHighPct: 0,
    intergovernmentalAidMillions: 0,
    treasuryBalance: 0,
    fiscalYear: 1,
    businessTaxRevenueMillions: 0,
    salaryTaxRevenueMillions: 0,
    cannabisSalesTaxRatePct: 0,
    cannabisSalesTaxRevenueMillions: 0,
    localSalesTaxRatePct: 0,
    localSalesTaxRevenueMillions: 0,
    officeSalaryPoolMillions: 0,
    publicSafety: 50,
    educationQuality: 50,
    housingAffordability: 45,
    businessClimate: 50,
    mayorApproval: 52,
    mayorElectoralApproval: 52,
    updatedAt: new Date(0).toISOString(),
    departments: CITY_FISCAL_DEPARTMENT_KEYS.map((departmentKey) => ({
      departmentKey,
      amountMillions: 0,
      minimumRequiredMillions: macroDeptMinimumMillions(departmentKey),
    })),
    recentEffects: [],
  };
}

function mapSnapshotRow(raw: {
  city_code: string;
  population: number;
  avg_household_income: number;
  economy_index: number;
  property_tax_rate_pct: number;
  business_tax_rate_pct?: number;
  income_tax_enabled: boolean;
  income_tax_flat?: boolean;
  income_tax_low_pct: number;
  income_tax_mid_pct: number;
  income_tax_high_pct: number;
  intergovernmental_aid_millions?: number;
  treasury_balance: number;
  fiscal_year: number;
  business_tax_revenue_millions?: number;
  salary_tax_revenue_millions?: number;
  cannabis_sales_tax_rate_pct?: number;
  cannabis_sales_tax_revenue_millions?: number;
  local_sales_tax_rate_pct?: number;
  local_sales_tax_revenue_millions?: number;
  office_salary_pool_millions?: number;
  public_safety?: number;
  education_quality?: number;
  housing_affordability?: number;
  business_climate?: number;
  mayor_approval?: number;
  mayor_electoral_approval?: number;
  updated_at: string;
  departments?: { department_key: string; amount_millions: number; minimum_required_millions?: number }[];
  recent_effects?: {
    id: string;
    source_type: string;
    source_id: string | null;
    title: string;
    summary: string;
    effects: Record<string, unknown>;
    created_at: string;
  }[];
}): CityFiscalSnapshot {
  return {
    cityCode: raw.city_code,
    population: Number(raw.population),
    avgHouseholdIncome: Number(raw.avg_household_income),
    economyIndex: Number(raw.economy_index),
    propertyTaxRatePct: Number(raw.property_tax_rate_pct),
    businessTaxRatePct: Number(raw.business_tax_rate_pct ?? DEFAULT_BUSINESS_TAX_RATE_PCT),
    incomeTaxEnabled: Boolean(raw.income_tax_enabled),
    incomeTaxFlat: Boolean(raw.income_tax_flat ?? true),
    incomeTaxLowPct: Number(raw.income_tax_low_pct),
    incomeTaxMidPct: Number(raw.income_tax_mid_pct),
    incomeTaxHighPct: Number(raw.income_tax_high_pct),
    intergovernmentalAidMillions: Number(raw.intergovernmental_aid_millions ?? 0),
    treasuryBalance: Number(raw.treasury_balance),
    fiscalYear: Number(raw.fiscal_year),
    businessTaxRevenueMillions: Number(raw.business_tax_revenue_millions ?? 0),
    salaryTaxRevenueMillions: Number(raw.salary_tax_revenue_millions ?? 0),
    cannabisSalesTaxRatePct: Number(raw.cannabis_sales_tax_rate_pct ?? 0),
    cannabisSalesTaxRevenueMillions: Number(raw.cannabis_sales_tax_revenue_millions ?? 0),
    localSalesTaxRatePct: Number(raw.local_sales_tax_rate_pct ?? 0),
    localSalesTaxRevenueMillions: Number(raw.local_sales_tax_revenue_millions ?? 0),
    officeSalaryPoolMillions: Number(raw.office_salary_pool_millions ?? 0),
    publicSafety: Number(raw.public_safety ?? 50),
    educationQuality: Number(raw.education_quality ?? 50),
    housingAffordability: Number(raw.housing_affordability ?? 45),
    businessClimate: Number(raw.business_climate ?? 50),
    mayorApproval: Number(raw.mayor_approval ?? 52),
    mayorElectoralApproval: Number(raw.mayor_electoral_approval ?? raw.mayor_approval ?? 52),
    updatedAt: raw.updated_at,
    departments: CITY_FISCAL_DEPARTMENT_KEYS.map((departmentKey) => {
      const row = (raw.departments ?? []).find((d) => d.department_key === departmentKey);
      return {
        departmentKey,
        amountMillions: Number(row?.amount_millions ?? 0),
        minimumRequiredMillions: Number(row?.minimum_required_millions ?? 0),
      };
    }),
    recentEffects: (raw.recent_effects ?? []).map((e) => ({
      id: e.id,
      sourceType: e.source_type,
      sourceId: e.source_id,
      title: e.title,
      summary: e.summary,
      effects: e.effects,
      createdAt: e.created_at,
    })),
  };
}

export async function loadCityFiscalSnapshot(
  supabase: SupabaseClient,
  cityCode = NYC_CITY_CODE,
): Promise<CityFiscalSnapshot> {
  await refreshCityBusinessTaxRevenue(supabase, cityCode);

  try {
    const { error: treasuryErr } = await supabase.rpc("sync_city_treasury_balance", {
      p_city_code: cityCode,
    });
    if (treasuryErr) console.warn("[city-fiscal-data] treasury sync:", treasuryErr.message);
  } catch (err) {
    console.warn("[city-fiscal-data] treasury sync failed:", err);
  }

  const [fiscalRes, officeSalaryBase] = await Promise.all([
    supabase.rpc("get_city_fiscal_snapshot", { p_city_code: cityCode }),
    loadCityOfficeSalaryTaxBase(supabase),
  ]);

  const { data, error } = fiscalRes;

  if (error) {
    console.warn("[city-fiscal-data] snapshot:", error.message);
    return emptyCityFiscalSnapshot(cityCode);
  }

  const snapshot = mapSnapshotRow(data as Parameters<typeof mapSnapshotRow>[0]);
  snapshot.officeSalaryBase = officeSalaryBase;
  const totals = computeCityFiscalTotals(snapshot);
  snapshot.revenueBreakdown = {
    source: totals.revenueSource,
    propertyTaxMillions: totals.propertyTaxRevenueMillions,
    wageIncomeTaxMillions: totals.wageIncomeTaxRevenueMillions,
    businessTaxMillions: totals.businessTaxRevenueMillions,
    salaryTaxMillions: totals.salaryTaxRevenueMillions,
    cannabisSalesTaxMillions: totals.cannabisSalesTaxRevenueMillions,
    localSalesTaxMillions: totals.localSalesTaxRevenueMillions,
    intergovernmentalAidMillions: totals.intergovernmentalAidMillions,
    totalRevenueMillions: totals.totalRevenueMillions,
  };
  logCityRevenueBreakdown(snapshot.revenueBreakdown, officeSalaryBase);
  return snapshot;
}

export function departmentAllocationsRecord(
  departments: CityFiscalDepartmentAllocation[],
): Record<CityFiscalDepartmentKey, number> {
  const map = Object.fromEntries(
    departments.map((d) => [d.departmentKey, d.amountMillions]),
  ) as Record<CityFiscalDepartmentKey, number>;
  for (const key of CITY_FISCAL_DEPARTMENT_KEYS) {
    if (map[key] === undefined) map[key] = 0;
  }
  return map;
}

export function formatFiscalCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export { formatBudgetMillions };

export function formatPopulation(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
