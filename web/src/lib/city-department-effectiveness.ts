/**
 * Department funding effectiveness — underfunding penalties, ward-weighted bonuses,
 * and underperformance detection vs expected metric movement.
 */

import type { CityFiscalDepartmentKey } from "@/lib/city-fiscal-data";
import type { CityMetricKey } from "@/lib/city-metrics-graph";
import {
  CITY_DEPARTMENT_KEYS,
  DEPARTMENT_LABELS,
  DEPARTMENT_PRIMARY_METRICS,
  DEPT_BUDGET_BASELINES_MILLIONS,
  deptMinimumMillions,
} from "@/lib/city-department-budget";

export type DepartmentAllocation = {
  departmentKey: CityFiscalDepartmentKey;
  amountMillions: number;
  minimumMillions?: number;
};

export type DepartmentFundingState = {
  departmentKey: CityFiscalDepartmentKey;
  allocatedMillions: number;
  minimumMillions: number;
  baselineMillions: number;
  fundingRatio: number;
  belowMinimum: boolean;
  wardWeightedPriority: number;
};

export type DepartmentUnderperformanceEvent = {
  departmentKey: CityFiscalDepartmentKey;
  metric: CityMetricKey;
  expectedDelta: number;
  actualDelta: number;
  tick: number;
  headline: string;
  body: string;
};

const UNDERPERFORMANCE_RATIO_THRESHOLD = 0.45;
const BASE_TICK_IMPACT = 0.35;

function clampModifier(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value * 10) / 10));
}

export function buildDepartmentFundingStates(
  allocations: DepartmentAllocation[],
  wardPriorities: Record<string, Record<CityFiscalDepartmentKey, number>>,
  wardPopulationShares: Record<string, number>,
): DepartmentFundingState[] {
  const allocMap = new Map(allocations.map((a) => [a.departmentKey, a]));

  return CITY_DEPARTMENT_KEYS.map((dept) => {
    const row = allocMap.get(dept);
    const allocated = row?.amountMillions ?? 0;
    const minimum = row?.minimumMillions ?? deptMinimumMillions(dept);
    const baseline = DEPT_BUDGET_BASELINES_MILLIONS[dept];

    let wardWeightedPriority = 0;
    for (const [ward, share] of Object.entries(wardPopulationShares)) {
      const pri = wardPriorities[ward]?.[dept] ?? 0.2;
      wardWeightedPriority += share * pri;
    }

    return {
      departmentKey: dept,
      allocatedMillions: allocated,
      minimumMillions: minimum,
      baselineMillions: baseline,
      fundingRatio: minimum > 0 ? allocated / minimum : 1,
      belowMinimum: allocated < minimum,
      wardWeightedPriority,
    };
  });
}

/** Real approval penalty for underfunding (negative modifier on public_trust). */
export function computeUnderfundingPenalty(states: DepartmentFundingState[]): number {
  let penalty = 0;
  for (const s of states) {
    if (!s.belowMinimum) continue;
    const shortfall = (s.minimumMillions - s.allocatedMillions) / s.minimumMillions;
    penalty += shortfall * 8 * (0.5 + s.wardWeightedPriority);
  }
  return clampModifier(penalty, 0, 18);
}

/** Approval bonus for dollars above minimum, ward-demographic weighted. */
export function computeOverfundingBonus(states: DepartmentFundingState[]): number {
  let bonus = 0;
  for (const s of states) {
    if (s.allocatedMillions <= s.minimumMillions) continue;
    const surplus = (s.allocatedMillions - s.minimumMillions) / s.minimumMillions;
    bonus += Math.min(surplus, 0.5) * 5 * s.wardWeightedPriority;
  }
  return clampModifier(bonus, 0, 12);
}

export function departmentFundingApprovalModifier(states: DepartmentFundingState[]): number {
  return computeOverfundingBonus(states) - computeUnderfundingPenalty(states);
}

/** Expected metric movement this tick given funding level (vs minimum). */
export function expectedMetricDeltasForTick(
  states: DepartmentFundingState[],
): Partial<Record<CityMetricKey, number>> {
  const out: Partial<Record<CityMetricKey, number>> = {};

  for (const s of states) {
    if (s.belowMinimum) {
      for (const metric of DEPARTMENT_PRIMARY_METRICS[s.departmentKey]) {
        const cur = out[metric] ?? 0;
        out[metric] = cur - ((s.minimumMillions - s.allocatedMillions) / s.minimumMillions) * BASE_TICK_IMPACT;
      }
      continue;
    }

    const lift = (s.fundingRatio - 1) * BASE_TICK_IMPACT * (0.6 + s.wardWeightedPriority * 0.8);
    for (const metric of DEPARTMENT_PRIMARY_METRICS[s.departmentKey]) {
      out[metric] = (out[metric] ?? 0) + lift;
    }
  }

  return out;
}

const UNDERPERFORMANCE_TEMPLATES: Record<
  CityFiscalDepartmentKey,
  { headline: string; body: string }
> = {
  police: {
    headline: "Police department missing public-safety targets",
    body: "{dept} was funded to improve public safety, but crime indicators moved the wrong way this period — council oversight hearings are being scheduled.",
  },
  public_works: {
    headline: "Public Works underdelivering on infrastructure",
    body: "Streets and housing metrics lagged what {dept} funding should have produced; contractors are blaming procurement delays.",
  },
  parks: {
    headline: "Parks & schools not seeing promised gains",
    body: "{dept} spending has not translated into education or environmental improvements residents were promised.",
  },
  planning: {
    headline: "Planning department fails economic benchmarks",
    body: "Business permits and economic indicators underperformed despite {dept} allocations — developers are going public with frustration.",
  },
  finance: {
    headline: "Finance department missing fiscal targets",
    body: "Treasury operations and public trust slipped despite {dept} staffing levels; auditors want a mid-year review.",
  },
};

export function detectDepartmentUnderperformance(input: {
  tick: number;
  before: Record<CityMetricKey, number>;
  after: Record<CityMetricKey, number>;
  fundingStates: DepartmentFundingState[];
}): DepartmentUnderperformanceEvent[] {
  const expected = expectedMetricDeltasForTick(input.fundingStates);
  const events: DepartmentUnderperformanceEvent[] = [];

  for (const state of input.fundingStates) {
    if (state.belowMinimum || state.fundingRatio < 0.95) continue;

    for (const metric of DEPARTMENT_PRIMARY_METRICS[state.departmentKey]) {
      const exp = expected[metric];
      if (exp == null || exp <= 0.05) continue;

      const actual = (input.after[metric] ?? 0) - (input.before[metric] ?? 0);
      if (actual >= exp * UNDERPERFORMANCE_RATIO_THRESHOLD) continue;

      const template = UNDERPERFORMANCE_TEMPLATES[state.departmentKey];
      const label = DEPARTMENT_LABELS[state.departmentKey];
      events.push({
        departmentKey: state.departmentKey,
        metric,
        expectedDelta: exp,
        actualDelta: actual,
        tick: input.tick,
        headline: template.headline,
        body: template.body.replaceAll("{dept}", label),
      });
      break;
    }
  }

  return events.slice(0, 1);
}
