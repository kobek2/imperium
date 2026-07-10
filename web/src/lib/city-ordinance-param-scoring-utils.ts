/**
 * Shared scoring helpers for parametric ordinance bills.
 */

import type { OrdinanceIssueScores } from "@/lib/city-ordinance-scoring";

export const PARAM_SCORE_EXPONENT = 1.7;

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampIssueScores(scores: OrdinanceIssueScores): OrdinanceIssueScores {
  return {
    issue_economic_score: clampNumber(scores.issue_economic_score, -99, 99),
    issue_social_score: clampNumber(scores.issue_social_score, -99, 99),
  };
}

/** Normalized magnitude 0–1 from a continuous param (sign-preserving for negative ranges). */
export function powerCurveNorm(value: number, min: number, max: number, exponent = PARAM_SCORE_EXPONENT): number {
  if (value >= 0 && max > 0) {
    return Math.pow(clampNumber(value, 0, max) / max, exponent);
  }
  if (value < 0 && min < 0) {
    return Math.pow(clampNumber(value, min, 0) / min, exponent);
  }
  return 0;
}

/** Discrete ordinal step with escalating weight (later steps matter more). */
export function escalatingStepScore(
  stepIndex: number,
  maxStepIndex: number,
  maxScore: number,
  sign: 1 | -1,
  exponent = PARAM_SCORE_EXPONENT,
): number {
  if (stepIndex <= 0 || maxStepIndex <= 0) return 0;
  const norm = Math.pow(stepIndex / maxStepIndex, exponent);
  return Math.round(norm * maxScore) * sign;
}

/** Anchor scores at each ordinal stop (for 3-way strategy axes). */
export function ordinalAnchorScore(stepIndex: number, anchors: number[]): number {
  const idx = clampNumber(stepIndex, 0, anchors.length - 1);
  return anchors[idx] ?? 0;
}

export function signedContinuousScore(
  value: number,
  min: number,
  max: number,
  maxPositiveScore: number,
  maxNegativeScore: number,
): number {
  if (Math.abs(value) < 0.001) return 0;
  if (value > 0) {
    return Math.round(powerCurveNorm(value, 0, max) * maxPositiveScore);
  }
  return -Math.round(powerCurveNorm(value, min, 0) * maxNegativeScore);
}
