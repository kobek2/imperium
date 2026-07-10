/**
 * Police Staffing & Community Programs — parametric ordinance (continuous + ordinal).
 */

import type { OrdinanceIssueScores } from "@/lib/city-ordinance-scoring";
import type { PolicyVariableDelta } from "@/lib/city-metrics-engine";
import {
  clampIssueScores,
  clampNumber,
  ordinalAnchorScore,
  PARAM_SCORE_EXPONENT,
  powerCurveNorm,
  signedContinuousScore,
} from "@/lib/city-ordinance-param-scoring-utils";
import {
  type OrdinanceBillParamSchema,
  ordinalStepIndex,
} from "@/lib/city-ordinance-param-schema";

export const POLICING_ISSUE_KEY = "policing_community_programs";

export type PolicingStrategy = "community_outreach" | "balanced" | "enforcement_heavy";

export type PolicingStanceParams = {
  staffing_level: number;
  strategy: PolicingStrategy;
};

export const POLICING_STAFFING_MIN = -20;
export const POLICING_STAFFING_MAX = 50;

export const POLICING_STRATEGY_STEPS: { value: PolicingStrategy; label: string }[] = [
  { value: "community_outreach", label: "Community outreach" },
  { value: "balanced", label: "Balanced" },
  { value: "enforcement_heavy", label: "Enforcement-heavy" },
];

const STRATEGY_ECON_ANCHORS = [-25, 0, 30];
const STRATEGY_SOC_ANCHORS = [-58, 0, 55];

export const POLICING_BILL_SCHEMA: OrdinanceBillParamSchema = {
  issueKey: POLICING_ISSUE_KEY,
  label: "Police staffing & community programs",
  parameters: [
    {
      key: "staffing_level",
      kind: "continuous",
      label: "Staffing change",
      min: POLICING_STAFFING_MIN,
      max: POLICING_STAFFING_MAX,
      step: 5,
      suffix: "%",
    },
    {
      key: "strategy",
      kind: "ordinal",
      label: "Deployment strategy",
      ordinalSteps: POLICING_STRATEGY_STEPS,
    },
  ],
};

export function isPolicingIssue(issueKey: string): boolean {
  return issueKey.toLowerCase().trim() === POLICING_ISSUE_KEY;
}

export function clampPolicingStanceParams(raw: Partial<PolicingStanceParams>): PolicingStanceParams {
  const strategy = POLICING_STRATEGY_STEPS.some((s) => s.value === raw.strategy)
    ? (raw.strategy as PolicingStrategy)
    : "balanced";

  return {
    staffing_level: clampNumber(
      Number(raw.staffing_level ?? 0),
      POLICING_STAFFING_MIN,
      POLICING_STAFFING_MAX,
    ),
    strategy,
  };
}

export function scorePolicingOrdinance(raw: PolicingStanceParams): OrdinanceIssueScores {
  const p = clampPolicingStanceParams(raw);
  const stratIdx = ordinalStepIndex(p.strategy, POLICING_STRATEGY_STEPS);

  const staffEcon = signedContinuousScore(
    p.staffing_level,
    POLICING_STAFFING_MIN,
    POLICING_STAFFING_MAX,
    40,
    32,
  );
  const staffSoc =
    p.staffing_level >= 0
      ? Math.round(powerCurveNorm(p.staffing_level, 0, POLICING_STAFFING_MAX) * 20)
      : -Math.round(
          powerCurveNorm(p.staffing_level, POLICING_STAFFING_MIN, 0) * 18,
        );

  const stratEcon = ordinalAnchorScore(stratIdx, STRATEGY_ECON_ANCHORS);
  const stratSoc = ordinalAnchorScore(stratIdx, STRATEGY_SOC_ANCHORS);

  const staffAmp =
    1 +
    (p.staffing_level >= 0
      ? powerCurveNorm(p.staffing_level, 0, POLICING_STAFFING_MAX) * 0.35
      : powerCurveNorm(p.staffing_level, POLICING_STAFFING_MIN, 0) * 0.35);

  const socRedirect = stratIdx === 0 ? 1.12 : stratIdx === 2 ? 0.88 : 1;

  return clampIssueScores({
    issue_economic_score: Math.round(stratEcon * staffAmp + staffEcon),
    issue_social_score: Math.round((stratSoc + staffSoc) * socRedirect),
  });
}

export function policingParamsToPolicyDeltas(raw: PolicingStanceParams): PolicyVariableDelta {
  const p = clampPolicingStanceParams(raw);
  const stratIdx = ordinalStepIndex(p.strategy, POLICING_STRATEGY_STEPS);
  const staffMag =
    p.staffing_level >= 0
      ? powerCurveNorm(p.staffing_level, 0, POLICING_STAFFING_MAX, PARAM_SCORE_EXPONENT)
      : powerCurveNorm(p.staffing_level, POLICING_STAFFING_MIN, 0, PARAM_SCORE_EXPONENT);

  const policeSign = p.staffing_level >= 0 ? 1 : -1;
  let policeFunding = Math.round(staffMag * 8 * policeSign);
  let communityPrograms = Math.round(staffMag * 4);

  if (stratIdx === 0) {
    communityPrograms += Math.round(staffMag * 5);
    policeFunding = Math.round(policeFunding * 0.75);
  } else if (stratIdx === 2) {
    policeFunding = Math.round(policeFunding * 1.25);
    communityPrograms -= Math.round(staffMag * 3);
  }

  return { police_funding: policeFunding, community_programs: communityPrograms };
}

export function formatPolicingPolicyStatus(raw: Partial<PolicingStanceParams>): string {
  const p = clampPolicingStanceParams(raw);
  const staff =
    Math.abs(p.staffing_level) < 1
      ? "hold staffing"
      : `${p.staffing_level > 0 ? "+" : ""}${p.staffing_level.toFixed(0)}% staffing`;
  const strategy =
    POLICING_STRATEGY_STEPS.find((s) => s.value === p.strategy)?.label ?? p.strategy;
  return `${staff} · ${strategy}`;
}

export function buildPolicingOrdinanceTitle(params: PolicingStanceParams): string {
  const p = clampPolicingStanceParams(params);
  const strategy =
    POLICING_STRATEGY_STEPS.find((s) => s.value === p.strategy)?.label ?? p.strategy;
  const staff =
    Math.abs(p.staffing_level) < 1
      ? "flat staffing"
      : `${p.staffing_level > 0 ? "+" : ""}${p.staffing_level.toFixed(0)}% staffing`;
  return `Police Staffing & Community Programs — ${staff}, ${strategy}`;
}

export function buildPolicingOrdinanceSummary(params: PolicingStanceParams): string {
  const p = clampPolicingStanceParams(params);
  const strategy =
    POLICING_STRATEGY_STEPS.find((s) => s.value === p.strategy)?.label ?? p.strategy;
  const staffText =
    Math.abs(p.staffing_level) < 1
      ? "Maintains current sworn headcount."
      : p.staffing_level > 0
        ? `Increases NYPD staffing by ${p.staffing_level.toFixed(0)}% from baseline.`
        : `Reduces NYPD staffing by ${Math.abs(p.staffing_level).toFixed(0)}% from baseline.`;

  return `${staffText} Deployment strategy: ${strategy.toLowerCase()}. Adjusts patrol visibility and community safety grant lines across precincts.`;
}

export const DEFAULT_POLICING_STANCE_PARAMS: PolicingStanceParams = {
  staffing_level: 0,
  strategy: "balanced",
};
