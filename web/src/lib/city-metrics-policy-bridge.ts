/**
 * Maps enacted ordinances and budgets to policy-variable deltas (not direct metric jumps).
 * Keep ordinance/budget templates aligned with `city-sim-effects.ts` stances.
 */

import {
  clampPropertyTaxStanceParams,
  isPropertyTaxIssue,
  type PropertyTaxStanceParams,
} from "@/lib/city-ordinance-scoring";
import {
  clampMarijuanaStanceParams,
  isMarijuanaIssue,
  legalStatusOrdinal,
  type MarijuanaStanceParams,
} from "@/lib/marijuana-ordinance-scoring";
import {
  getParametricBillDefinition,
  isRegistryParametricIssue,
} from "@/lib/city-ordinance-param-registry";
import type { OrdinanceStanceParams } from "@/lib/city-ordinance-param-score";
import type { CityFiscalDepartmentKey } from "@/lib/city-fiscal-data";
import type { CityPolicyVariableKey } from "@/lib/city-metrics-graph";
import type { PolicyVariableDelta } from "@/lib/city-metrics-engine";
import { DEPT_BUDGET_BASELINES_MILLIONS } from "@/lib/city-department-budget";

const RATE_POLICY_EXPONENT = 1.7;

const DEPT_BASELINES = DEPT_BUDGET_BASELINES_MILLIONS;

function mergeDeltas(
  base: PolicyVariableDelta,
  patch: PolicyVariableDelta,
): PolicyVariableDelta {
  const out: PolicyVariableDelta = { ...base };
  for (const [key, value] of Object.entries(patch) as [CityPolicyVariableKey, number][]) {
    if (value == null) continue;
    out[key] = (out[key] ?? 0) + value;
  }
  return out;
}

function propertyTaxParamsToPolicyDeltas(params: PropertyTaxStanceParams): PolicyVariableDelta {
  const { rate_delta: rateDelta, earmark_services_pct: earmarkPct } =
    clampPropertyTaxStanceParams(params);
  const earmark = earmarkPct / 100;

  if (Math.abs(rateDelta) < 0.001) return {};

  const taxNorm =
    rateDelta < 0
      ? Math.pow(Math.abs(rateDelta / 5), RATE_POLICY_EXPONENT)
      : Math.pow(rateDelta / 15, RATE_POLICY_EXPONENT);
  const magnitude = taxNorm * 7;

  if (rateDelta < 0) {
    return {
      tax_burden: Math.round(-magnitude),
      housing_subsidy: Math.round(taxNorm * (1 - earmark) * 4),
      infrastructure_capital: Math.round(taxNorm * earmark * 2),
    };
  }

  return {
    tax_burden: Math.round(magnitude),
    infrastructure_capital: Math.round(magnitude * earmark * 0.85),
    housing_subsidy: Math.round(magnitude * (1 - earmark) * 0.45),
  };
}

const STATUS_POLICY_EXPONENT = 1.7;

function marijuanaParamsToPolicyDeltas(params: MarijuanaStanceParams): PolicyVariableDelta {
  const p = clampMarijuanaStanceParams(params);
  const step = legalStatusOrdinal(p.legal_status);
  if (step <= 0) return {};

  const norm = Math.pow(step / 3, STATUS_POLICY_EXPONENT);
  let d: PolicyVariableDelta = {
    community_programs: Math.round(norm * 6),
    police_funding: Math.round(-norm * 4),
  };

  if (p.commercial_sale_allowed) {
    d = mergeDeltas(d, {
      business_regulation: Math.round(-norm * 5),
      tax_burden: Math.round((p.sales_tax_rate / 40) * norm * 4),
    });
  }

  if (p.expungement) {
    d = mergeDeltas(d, { community_programs: 4 });
  }

  return d;
}

/** Ordinance enactment → immediate policy variable shifts. */
export function ordinanceToPolicyVariableDeltas(
  category: string,
  issueKey: string,
  stanceKey?: string | null,
  stanceParams?: OrdinanceStanceParams | null,
): PolicyVariableDelta {
  const cat = category.toLowerCase().trim();
  const issue = issueKey.toLowerCase().trim();
  const stance = (stanceKey ?? "").toLowerCase().trim();
  let d: PolicyVariableDelta = {};

  if (cat === "taxes" && isPropertyTaxIssue(issue)) {
    if (stanceParams && isPropertyTaxIssue(issue)) {
      return propertyTaxParamsToPolicyDeltas(stanceParams as PropertyTaxStanceParams);
    }
    if (stance === "progressive") {
      d = mergeDeltas(d, { tax_burden: -4, housing_subsidy: 2 });
    } else if (stance === "conservative") {
      d = mergeDeltas(d, { tax_burden: 5, infrastructure_capital: 2 });
    }
  } else if (isRegistryParametricIssue(issue) && stanceParams) {
    const bill = getParametricBillDefinition(issue);
    if (bill) return bill.policyDeltas(stanceParams as Record<string, unknown>);
  } else if (cat === "crime" && isMarijuanaIssue(issue)) {
    if (stanceParams) {
      return marijuanaParamsToPolicyDeltas(stanceParams as MarijuanaStanceParams);
    }
    if (stance === "progressive") {
      d = mergeDeltas(d, { business_regulation: -5 });
    } else if (stance === "conservative") {
      d = mergeDeltas(d, { business_regulation: 6 });
    }
  } else {
    if (stance === "progressive") d = mergeDeltas(d, { community_programs: 2 });
    else if (stance === "conservative") d = mergeDeltas(d, { business_regulation: -3 });
  }

  return d;
}

/** Budget enactment → department funding normalized to policy variable deltas. */
export function budgetToPolicyVariableDeltas(
  departments: { departmentKey: string; amountMillions: number }[],
  deficitMillions: number,
): PolicyVariableDelta {
  let d: PolicyVariableDelta = {};

  for (const dept of departments) {
    const baseline = DEPT_BASELINES[dept.departmentKey as CityFiscalDepartmentKey] ?? 0;
    if (baseline <= 0) continue;
    const ratio = dept.amountMillions / baseline;
    const delta = (ratio - 1) * 12;

    if (dept.departmentKey === "police") {
      d = mergeDeltas(d, { police_funding: Math.round(delta) });
    } else if (dept.departmentKey === "public_works") {
      d = mergeDeltas(d, {
        infrastructure_capital: Math.round(delta * 0.9),
        housing_subsidy: Math.round(delta * 0.3),
      });
    } else if (dept.departmentKey === "parks") {
      d = mergeDeltas(d, {
        school_funding: Math.round(delta * 0.5),
        community_programs: Math.round(delta * 0.4),
      });
    } else if (dept.departmentKey === "planning") {
      d = mergeDeltas(d, { business_regulation: Math.round(-delta * 0.4) });
    } else if (dept.departmentKey === "finance") {
      d = mergeDeltas(d, { tax_burden: Math.round(-delta * 0.2) });
    }
  }

  if (deficitMillions < -500) {
    d = mergeDeltas(d, {
      infrastructure_capital: -3,
      school_funding: -2,
      health_clinic_funding: -2,
    });
  } else if (deficitMillions > 150) {
    d = mergeDeltas(d, { infrastructure_capital: 2 });
  }

  return d;
}

export function formatPolicyVariableDeltas(deltas: PolicyVariableDelta): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(deltas) as [CityPolicyVariableKey, number][]) {
    if (!value) continue;
    const sign = value > 0 ? "+" : "";
    lines.push(`${key.replaceAll("_", " ")} ${sign}${value}`);
  }
  return lines;
}
