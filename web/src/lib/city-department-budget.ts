/**
 * Department budget baselines, minimums, and metric linkage for effectiveness checks.
 */

import type { CityFiscalDepartmentKey } from "@/lib/city-fiscal-data";
import type { CityMetricKey } from "@/lib/city-metrics-graph";

export const CITY_DEPARTMENT_KEYS = [
  "finance",
  "police",
  "public_works",
  "parks",
  "planning",
] as const satisfies readonly CityFiscalDepartmentKey[];

/** Enacted baseline (millions) — matches policy-bridge and SQL sim effects. */
export const DEPT_BUDGET_BASELINES_MILLIONS: Record<CityFiscalDepartmentKey, number> = {
  finance: 1200,
  police: 5800,
  public_works: 2500,
  parks: 700,
  planning: 150,
};

/** Minimum required allocation as a fraction of baseline. */
export const DEPT_MINIMUM_FRACTION = 0.75;

export function deptMinimumMillions(key: CityFiscalDepartmentKey): number {
  return DEPT_BUDGET_BASELINES_MILLIONS[key] * DEPT_MINIMUM_FRACTION;
}

export const DEPARTMENT_LABELS: Record<CityFiscalDepartmentKey, string> = {
  finance: "Finance",
  police: "Police",
  public_works: "Public Works",
  parks: "Parks & Recreation",
  planning: "City Planning",
};

/** Primary metrics each department is expected to move when adequately funded. */
export const DEPARTMENT_PRIMARY_METRICS: Record<CityFiscalDepartmentKey, CityMetricKey[]> = {
  police: ["crime"],
  public_works: ["infrastructure", "housing"],
  parks: ["education", "environment"],
  planning: ["economy"],
  finance: ["public_trust", "economy"],
};

/** Campaign / ordinance issue keys → department salience (sums normalized per ward). */
export const ISSUE_DEPARTMENT_WEIGHTS: Record<string, Partial<Record<CityFiscalDepartmentKey, number>>> = {
  school_funding: { parks: 0.55, public_works: 0.15 },
  policing_community_programs: { police: 0.7, parks: 0.2 },
  small_business_permits: { planning: 0.6, finance: 0.25 },
  minimum_wage: { finance: 0.45, planning: 0.35 },
  property_tax_rate: { finance: 0.65 },
  infrastructure_capital: { public_works: 0.75 },
  housing_subsidy: { public_works: 0.5, planning: 0.3 },
};
