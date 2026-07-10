/**
 * Coordinates approval rating with underlying city metrics for charts and UI.
 * Approval = 60% composite + 25% electoral + 15% (50 + dept funding modifier).
 */

import type { CityMetricKey } from "@/lib/city-metrics-graph";
import { CITY_METRIC_KEYS, CITY_METRIC_LABELS } from "@/lib/city-metrics-graph";
import type { CityMetricsEngineState } from "@/lib/city-metrics-engine";
import type { PolicyVariableDelta } from "@/lib/city-metrics-engine";
import {
  APPROVAL_WEIGHTS,
  approvalTier,
  blendMayorApprovalRating,
  computeApprovalRating,
  type ApprovalTier,
  type EnrichedCityMetricHistoryPoint,
} from "@/lib/city-metrics-presentation";
import { DEPT_REVENUE_SHARE } from "@/lib/city-player-budget";
import type { CityFiscalDepartmentKey } from "@/lib/city-fiscal-data";
import { annualGdpMillions } from "@/lib/city-player-budget";

export type ApprovalBreakdown = {
  blended: number;
  composite: number;
  electoral: number;
  departmentFundingModifier: number;
  departmentSlotValue: number;
  tier: ApprovalTier;
  cooperationBonus: number;
};

export type MetricApprovalContribution = {
  key: CityMetricKey;
  label: string;
  value: number;
  weight: number;
  contribution: number;
  shareOfCompositePct: number;
};

export type ApprovalTrendAlignment = {
  pointCount: number;
  avgGap: number;
  latestGap: number;
  aligned: boolean;
  summary: string;
  points: Array<{ tick: number; approval: number; composite: number; gap: number }>;
};

const COMPOSITE_BLEND = 0.6;
const ELECTORAL_BLEND = 0.25;
const DEPT_BLEND = 0.15;

export function buildApprovalBreakdown(input: {
  metrics: Record<CityMetricKey, number>;
  mayorElectoralApproval?: number | null;
  departmentFundingModifier?: number;
  cooperationBonus?: number;
}): ApprovalBreakdown {
  const composite = computeApprovalRating(input.metrics);
  const electoral = input.mayorElectoralApproval ?? composite;
  const deptMod = input.departmentFundingModifier ?? 0;
  const departmentSlotValue = 50 + deptMod;
  const blended = blendMayorApprovalRating({
    compositeApproval: composite,
    mayorElectoralApproval: electoral,
    departmentFundingModifier: deptMod,
  });

  return {
    blended,
    composite,
    electoral,
    departmentFundingModifier: deptMod,
    departmentSlotValue,
    tier: approvalTier(blended),
    cooperationBonus: input.cooperationBonus ?? 0,
  };
}

export function buildMetricContributions(
  metrics: Record<CityMetricKey, number>,
): MetricApprovalContribution[] {
  const composite = computeApprovalRating(metrics);
  const rows = CITY_METRIC_KEYS.map((key) => {
    const value = metrics[key] ?? 50;
    const weight = APPROVAL_WEIGHTS[key];
    const contribution = value * weight;
    return {
      key,
      label: CITY_METRIC_LABELS[key],
      value,
      weight,
      contribution,
      shareOfCompositePct: composite > 0 ? (contribution / composite) * 100 : 0,
    };
  });
  return rows.sort((a, b) => b.contribution - a.contribution);
}

/** Top metrics to overlay on the approval chart (highest composite weight × level). */
export function recommendedChartMetrics(
  metrics: Record<CityMetricKey, number>,
  count = 3,
): CityMetricKey[] {
  return buildMetricContributions(metrics)
    .slice(0, count)
    .map((r) => r.key);
}

export function buildApprovalTrendAlignment(
  history: EnrichedCityMetricHistoryPoint[],
): ApprovalTrendAlignment {
  if (history.length < 2) {
    return {
      pointCount: history.length,
      avgGap: 0,
      latestGap: 0,
      aligned: true,
      summary: "History builds as sim turns advance — approval will track metrics once ticks accumulate.",
      points: [],
    };
  }

  const points = history.map((p) => {
    const composite = computeApprovalRating(p.metrics);
    const approval = p.approvalRating ?? composite;
    return { tick: p.tick, approval, composite, gap: approval - composite };
  });

  const avgGap = points.reduce((s, p) => s + p.gap, 0) / points.length;
  const latestGap = points[points.length - 1]?.gap ?? 0;
  const aligned = Math.abs(latestGap) <= 8;

  let summary: string;
  if (aligned) {
    summary =
      latestGap >= 0
        ? "Approval is moving with city metrics, boosted slightly by electoral mandate or department funding."
        : "Approval is tracking metrics; department underfunding or electoral drag is pulling the headline down.";
  } else if (latestGap > 8) {
    summary =
      "Approval runs ahead of raw metrics — strong electoral mandate or overfunded departments are lifting the headline.";
  } else {
    summary =
      "Approval trails underlying metrics — underfunded departments or weak electoral mandate are weighing on the headline.";
  }

  return { pointCount: points.length, avgGap, latestGap, aligned, summary, points };
}

/** Player-scale budget → policy variables (vs GDP-indexed default dept shares). */
export function budgetToPolicyVariableDeltasPlayerScale(
  departments: { departmentKey: string; amountMillions: number }[],
  annualGdpUsd: number,
  deficitMillions: number,
  totalRevenueMillions: number,
): PolicyVariableDelta {
  let d: PolicyVariableDelta = {};
  const gdpM = annualGdpMillions(annualGdpUsd);
  if (gdpM <= 0) return d;

  const merge = (patch: PolicyVariableDelta) => {
    for (const [key, value] of Object.entries(patch) as [keyof PolicyVariableDelta, number][]) {
      if (value == null) continue;
      d[key] = (d[key] ?? 0) + value;
    }
  };

  for (const dept of departments) {
    const key = dept.departmentKey as CityFiscalDepartmentKey;
    const defaultM = (DEPT_REVENUE_SHARE[key] ?? 0) * gdpM;
    if (defaultM <= 0) continue;
    const ratio = dept.amountMillions / defaultM;
    const delta = (ratio - 1) * 12;

    if (key === "police") merge({ police_funding: Math.round(delta) });
    else if (key === "public_works")
      merge({ infrastructure_capital: Math.round(delta * 0.9), housing_subsidy: Math.round(delta * 0.3) });
    else if (key === "parks")
      merge({ school_funding: Math.round(delta * 0.5), community_programs: Math.round(delta * 0.4) });
    else if (key === "planning") merge({ business_regulation: Math.round(-delta * 0.4) });
    else if (key === "finance") merge({ tax_burden: Math.round(-delta * 0.2) });
  }

  if (totalRevenueMillions > 0) {
    const deficitRatio = -deficitMillions / totalRevenueMillions;
    if (deficitRatio > 0.15) {
      merge({ infrastructure_capital: -3, school_funding: -2, health_clinic_funding: -2 });
    } else if (deficitRatio < -0.1) {
      merge({ infrastructure_capital: 2 });
    }
  }

  return d;
}

export function previewBlendedApprovalChange(input: {
  beforeState: CityMetricsEngineState;
  afterMetrics: Record<CityMetricKey, number>;
  mayorElectoralApproval?: number | null;
  departmentFundingModifier?: number;
}): { before: number; after: number; delta: number; breakdown: ApprovalBreakdown } {
  const beforeBreakdown = buildApprovalBreakdown({
    metrics: input.beforeState.metrics,
    mayorElectoralApproval: input.mayorElectoralApproval,
    departmentFundingModifier: input.departmentFundingModifier,
  });
  const afterBreakdown = buildApprovalBreakdown({
    metrics: input.afterMetrics,
    mayorElectoralApproval: input.mayorElectoralApproval,
    departmentFundingModifier: input.departmentFundingModifier,
  });
  return {
    before: beforeBreakdown.blended,
    after: afterBreakdown.blended,
    delta: afterBreakdown.blended - beforeBreakdown.blended,
    breakdown: afterBreakdown,
  };
}

export const APPROVAL_BLEND_WEIGHTS = {
  composite: COMPOSITE_BLEND,
  electoral: ELECTORAL_BLEND,
  department: DEPT_BLEND,
} as const;
