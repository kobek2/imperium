/**
 * Player-facing translation layer for the city metrics engine.
 * Does not modify graph propagation — derives approval, narratives, and consequences.
 */

import type { CityMetricKey } from "@/lib/city-metrics-graph";
import { CITY_METRIC_KEYS } from "@/lib/city-metrics-graph";
import type { CityMetricHistoryPoint } from "@/lib/city-metrics-engine";

/** Weighted composite (0–100) — not an independent simulated metric. */
export const APPROVAL_WEIGHTS: Record<CityMetricKey, number> = {
  public_trust: 0.28,
  economy: 0.18,
  crime: 0.18,
  education: 0.1,
  housing: 0.08,
  public_health: 0.08,
  infrastructure: 0.06,
  environment: 0.04,
};

export type ApprovalTier = "strong" | "stable" | "shaky" | "critical";

export type MetricDeltaTier = "negligible" | "minor" | "notable" | "major";

export type MetricNarrativeEvent = {
  metric: CityMetricKey;
  tier: MetricDeltaTier;
  direction: "positive" | "negative";
  tick: number;
  policyName: string;
  headline: string;
  body: string;
};

export type EnrichedCityMetricHistoryPoint = CityMetricHistoryPoint & {
  approvalRating: number;
};

export type DepartmentPresentationEvent = {
  departmentKey: string;
  metric: string;
  tick: number;
  headline: string;
  body: string;
};

export type PresentationTickOutcome = {
  enrichedHistory: EnrichedCityMetricHistoryPoint[];
  narrativeEvents: MetricNarrativeEvent[];
  departmentEvents: DepartmentPresentationEvent[];
  approvalTier: ApprovalTier;
  cooperationBonus: number;
  primaryChallengerSurfaced: boolean;
  lowApprovalBriefing: string | null;
};

export const APPROVAL_LOW_THRESHOLD = 35;
export const APPROVAL_CRITICAL_THRESHOLD = 25;

const POC_NARRATIVE_METRICS: CityMetricKey[] = ["education", "economy", "public_trust"];

function clampApproval(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function computeApprovalRating(metrics: Record<CityMetricKey, number>): number {
  let sum = 0;
  for (const key of CITY_METRIC_KEYS) {
    sum += (metrics[key] ?? 50) * APPROVAL_WEIGHTS[key];
  }
  return clampApproval(sum);
}

/** Blend operational composite with electoral mandate and department funding modifier. */
export function blendMayorApprovalRating(input: {
  compositeApproval: number;
  mayorElectoralApproval?: number | null;
  departmentFundingModifier?: number;
}): number {
  const composite = input.compositeApproval;
  const electoral = input.mayorElectoralApproval ?? composite;
  const deptMod = input.departmentFundingModifier ?? 0;
  const blended = composite * 0.6 + electoral * 0.25 + (50 + deptMod) * 0.15;
  return clampApproval(blended);
}

export function approvalTier(rating: number): ApprovalTier {
  if (rating >= 65) return "strong";
  if (rating >= 50) return "stable";
  if (rating >= APPROVAL_LOW_THRESHOLD) return "shaky";
  return "critical";
}

/** Negative = easier council cooperation for the mayor's coalition. */
export function cooperationBonusFromApproval(rating: number): number {
  if (rating >= 70) return -12;
  if (rating >= 58) return -8;
  if (rating >= 50) return -4;
  if (rating >= APPROVAL_LOW_THRESHOLD) return 0;
  if (rating >= APPROVAL_CRITICAL_THRESHOLD) return 8;
  return 14;
}

export function classifyMetricDelta(delta: number): MetricDeltaTier {
  const abs = Math.abs(delta);
  if (abs < 1) return "negligible";
  if (abs < 3) return "minor";
  if (abs < 6) return "notable";
  return "major";
}

function metricDeltas(
  before: Record<CityMetricKey, number>,
  after: Record<CityMetricKey, number>,
): Partial<Record<CityMetricKey, number>> {
  const out: Partial<Record<CityMetricKey, number>> = {};
  for (const key of CITY_METRIC_KEYS) {
    const d = (after[key] ?? 0) - (before[key] ?? 0);
    if (d !== 0) out[key] = d;
  }
  return out;
}

type TemplateSet = { headlines: string[]; bodies: string[] };

const NARRATIVE_TEMPLATES: Record<
  CityMetricKey,
  Record<"positive" | "negative", Record<"notable" | "major", TemplateSet>>
> = {
  education: {
    positive: {
      notable: {
        headlines: ["Classroom gains showing up in the data"],
        bodies: [
          "Principals report measurable improvement after {policy_name} — parent satisfaction is ticking up.",
        ],
      },
      major: {
        headlines: ["Schools surge in city report cards"],
        bodies: [
          "District leaders credit {policy_name} for a sharp jump in outcomes; unions are cautiously optimistic.",
        ],
      },
    },
    negative: {
      notable: {
        headlines: ["Parents notice slippage in school quality"],
        bodies: [
          "PTA chapters are organizing after {policy_name} — test prep vendors warn scores may soften this term.",
        ],
      },
      major: {
        headlines: ["Education backlash builds citywide"],
        bodies: [
          "Parents are furious after {policy_name} — test scores are expected to drop sharply and turnout at school board forums is spiking.",
        ],
      },
    },
  },
  economy: {
    positive: {
      notable: {
        headlines: ["Business confidence inches up"],
        bodies: [
          "Chamber of Commerce cites {policy_name} as a stabilizer — hiring notices rose in the last survey window.",
        ],
      },
      major: {
        headlines: ["Economy humming on main streets"],
        bodies: [
          "Retail and payroll data jumped following {policy_name}; mayoral allies are already cutting victory ads.",
        ],
      },
    },
    negative: {
      notable: {
        headlines: ["Shop owners nervous about the outlook"],
        bodies: [
          "Small-business owners blame {policy_name} for tighter margins; commercial vacancy watchlists are trending up.",
        ],
      },
      major: {
        headlines: ["Economic warning lights flash downtown"],
        bodies: [
          "Analysts tie a sharp slowdown to {policy_name}; layoff rumors are spreading through the borough chambers.",
        ],
      },
    },
  },
  public_trust: {
    positive: {
      notable: {
        headlines: ["Residents give City Hall a second look"],
        bodies: [
          "Polling after {policy_name} shows trust recovering — neighborhood associations report fewer complaint calls.",
        ],
      },
      major: {
        headlines: ["City Hall regains the public's ear"],
        bodies: [
          "Trust spiked after {policy_name}; community boards say residents are willing to give the administration runway.",
        ],
      },
    },
    negative: {
      notable: {
        headlines: ["Skepticism toward City Hall grows"],
        bodies: [
          "Civic groups cite {policy_name} as proof the administration is out of touch; local press is sharpening headlines.",
        ],
      },
      major: {
        headlines: ["Trust in City Hall craters"],
        bodies: [
          "Voters are openly angry about {policy_name}; talk radio is fielding calls for leadership change before the next cycle.",
        ],
      },
    },
  },
  crime: { positive: { notable: { headlines: [], bodies: [] }, major: { headlines: [], bodies: [] } }, negative: { notable: { headlines: [], bodies: [] }, major: { headlines: [], bodies: [] } } },
  public_health: { positive: { notable: { headlines: [], bodies: [] }, major: { headlines: [], bodies: [] } }, negative: { notable: { headlines: [], bodies: [] }, major: { headlines: [], bodies: [] } } },
  housing: { positive: { notable: { headlines: [], bodies: [] }, major: { headlines: [], bodies: [] } }, negative: { notable: { headlines: [], bodies: [] }, major: { headlines: [], bodies: [] } } },
  infrastructure: { positive: { notable: { headlines: [], bodies: [] }, major: { headlines: [], bodies: [] } }, negative: { notable: { headlines: [], bodies: [] }, major: { headlines: [], bodies: [] } } },
  environment: { positive: { notable: { headlines: [], bodies: [] }, major: { headlines: [], bodies: [] } }, negative: { notable: { headlines: [], bodies: [] }, major: { headlines: [], bodies: [] } } },
};

function fillTemplate(template: string, policyName: string): string {
  return template.replaceAll("{policy_name}", policyName);
}

function pickTemplate(set: TemplateSet, seed: number): { headline: string; body: string } {
  const idx = Math.abs(seed) % Math.max(1, set.headlines.length);
  return {
    headline: set.headlines[idx] ?? "City conditions shifted",
    body: set.bodies[idx] ?? "Residents are reacting to recent policy changes.",
  };
}

export function generateMetricNarratives(input: {
  tick: number;
  before: Record<CityMetricKey, number>;
  after: Record<CityMetricKey, number>;
  policyName?: string;
  seed?: number;
  metrics?: CityMetricKey[];
}): MetricNarrativeEvent[] {
  const policyName = input.policyName?.trim() || "recent council action";
  const deltas = metricDeltas(input.before, input.after);
  const targetMetrics = input.metrics ?? POC_NARRATIVE_METRICS;
  const events: MetricNarrativeEvent[] = [];

  for (const metric of targetMetrics) {
    const delta = deltas[metric];
    if (delta == null || delta === 0) continue;
    const tier = classifyMetricDelta(delta);
    if (tier === "negligible" || tier === "minor") continue;

    const direction = delta > 0 ? "positive" : "negative";
    const templateTier = tier === "major" ? "major" : "notable";
    const set = NARRATIVE_TEMPLATES[metric][direction][templateTier];
    if (!set.headlines.length) continue;

    const picked = pickTemplate(set, (input.seed ?? 0) ^ metric.length ^ delta);
    events.push({
      metric,
      tier,
      direction,
      tick: input.tick,
      policyName,
      headline: fillTemplate(picked.headline, policyName),
      body: fillTemplate(picked.body, policyName),
    });
  }

  return events.slice(0, 2);
}

export function enrichHistoryPoint(
  point: CityMetricHistoryPoint,
  approvalRating?: number,
): EnrichedCityMetricHistoryPoint {
  return {
    ...point,
    approvalRating: approvalRating ?? computeApprovalRating(point.metrics),
  };
}

export function lowApprovalBriefingCopy(rating: number): string | null {
  if (rating >= APPROVAL_LOW_THRESHOLD) return null;
  if (rating < APPROVAL_CRITICAL_THRESHOLD) {
    return "Chief of Staff memo: approval is in free fall. A named primary challenger is almost certain next cycle unless you change the narrative immediately.";
  }
  return "Chief of Staff memo: voter patience is thin. Operatives are shopping a primary challenger for next cycle if conditions do not improve.";
}

export function primaryChallengerHeadline(target: "mayor" | "council"): string {
  return target === "mayor"
    ? "Primary challenger surfaces — mayor's reelection"
    : "Primary challenger surfaces — council seat";
}

export function processPresentationAfterTicks(input: {
  priorMetrics: Record<CityMetricKey, number>;
  priorApproval: number;
  newHistory: CityMetricHistoryPoint[];
  policyName?: string;
  seed?: number;
  challengerAlreadySurfaced?: boolean;
  mayorElectoralApproval?: number | null;
  departmentFundingModifier?: number;
  departmentEvents?: DepartmentPresentationEvent[];
}): PresentationTickOutcome {
  const enrichedHistory: EnrichedCityMetricHistoryPoint[] = [];
  const narrativeEvents: MetricNarrativeEvent[] = [];
  let before = input.priorMetrics;
  let lastApproval = input.priorApproval;
  let primaryChallengerSurfaced = false;
  let lowApprovalBriefing: string | null = null;

  for (const point of input.newHistory) {
    const composite = computeApprovalRating(point.metrics);
    const approvalRating = blendMayorApprovalRating({
      compositeApproval: composite,
      mayorElectoralApproval: input.mayorElectoralApproval,
      departmentFundingModifier: input.departmentFundingModifier,
    });
    enrichedHistory.push(enrichHistoryPoint(point, approvalRating));

    narrativeEvents.push(
      ...generateMetricNarratives({
        tick: point.tick,
        before,
        after: point.metrics,
        policyName: input.policyName,
        seed: (input.seed ?? 0) ^ point.tick,
      }),
    );

    before = point.metrics;
    lastApproval = approvalRating;
  }

  const tier = approvalTier(lastApproval);
  if (lastApproval < APPROVAL_LOW_THRESHOLD && !input.challengerAlreadySurfaced) {
    primaryChallengerSurfaced = true;
  }
  if (
    input.priorApproval >= APPROVAL_LOW_THRESHOLD &&
    lastApproval < APPROVAL_LOW_THRESHOLD
  ) {
    lowApprovalBriefing = lowApprovalBriefingCopy(lastApproval);
  } else if (lastApproval < APPROVAL_CRITICAL_THRESHOLD && tier === "critical") {
    lowApprovalBriefing = lowApprovalBriefingCopy(lastApproval);
  }

  return {
    enrichedHistory,
    narrativeEvents: dedupeNarratives(narrativeEvents).slice(0, 2),
    departmentEvents: input.departmentEvents ?? [],
    approvalTier: tier,
    cooperationBonus: cooperationBonusFromApproval(lastApproval),
    primaryChallengerSurfaced,
    lowApprovalBriefing,
  };
}

function dedupeNarratives(events: MetricNarrativeEvent[]): MetricNarrativeEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${e.metric}:${e.direction}:${e.tier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Preview helper for ordinance UI — narrative lines instead of raw metric deltas. */
export function previewPolicyNarratives(input: {
  before: Record<CityMetricKey, number>;
  after: Record<CityMetricKey, number>;
  policyName: string;
}): string[] {
  const events = generateMetricNarratives({
    tick: 0,
    before: input.before,
    after: input.after,
    policyName: input.policyName,
    metrics: POC_NARRATIVE_METRICS,
  });
  if (!events.length) {
    return ["Most city indicators should hold steady — no major headlines expected in the near term."];
  }
  return events.map((e) => e.body);
}

export function approvalTone(rating: number): "good" | "mid" | "bad" {
  if (rating >= 60) return "good";
  if (rating >= 40) return "mid";
  return "bad";
}
