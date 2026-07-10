/**
 * Continuous ordinance stance scoring (property tax POC).
 * Curve: sign-preserving power law — small moves stay modest; extremes escalate.
 */

import type { OrdinanceStanceKey } from "@/lib/city-ordinance-templates";

export type PropertyTaxStanceParams = {
  rate_delta: number;
  earmark_services_pct: number;
};

export type OrdinanceIssueScores = {
  issue_economic_score: number;
  issue_social_score: number;
};

export const PROPERTY_TAX_RATE_DELTA_MIN = -5;
export const PROPERTY_TAX_RATE_DELTA_MAX = 15;
export const PROPERTY_TAX_EARMARK_MIN = 0;
export const PROPERTY_TAX_EARMARK_MAX = 100;

/** Escalating slope near extremes (not linear). */
const RATE_ECON_EXPONENT = 1.7;
const RATE_ECON_MAX_CUT = 88;
const RATE_ECON_MAX_HIKE = 95;

const SOCIAL_AT_ZERO_EARMARK = 35;
const SOCIAL_AT_FULL_EARMARK = -45;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function signPreservingPower(norm: number, exponent: number): number {
  const n = Math.abs(norm);
  if (n === 0) return 0;
  return Math.sign(norm) * Math.pow(n, exponent);
}

export function clampPropertyTaxStanceParams(
  raw: Partial<PropertyTaxStanceParams>,
): PropertyTaxStanceParams {
  return {
    rate_delta: clamp(
      Number(raw.rate_delta ?? 0),
      PROPERTY_TAX_RATE_DELTA_MIN,
      PROPERTY_TAX_RATE_DELTA_MAX,
    ),
    earmark_services_pct: clamp(
      Number(raw.earmark_services_pct ?? 50),
      PROPERTY_TAX_EARMARK_MIN,
      PROPERTY_TAX_EARMARK_MAX,
    ),
  };
}

/** rate_delta → issue_economic_score with escalating extremes. */
export function economicScoreFromRateDelta(rateDelta: number): number {
  const rd = clamp(rateDelta, PROPERTY_TAX_RATE_DELTA_MIN, PROPERTY_TAX_RATE_DELTA_MAX);
  if (Math.abs(rd) < 0.001) return 0;

  if (rd < 0) {
    const norm = rd / PROPERTY_TAX_RATE_DELTA_MIN;
    return Math.round(signPreservingPower(norm, RATE_ECON_EXPONENT) * RATE_ECON_MAX_CUT);
  }

  const norm = rd / PROPERTY_TAX_RATE_DELTA_MAX;
  return Math.round(Math.pow(norm, RATE_ECON_EXPONENT) * RATE_ECON_MAX_HIKE);
}

/** earmark_services_pct → issue_social_score (higher services share = more progressive). */
export function socialScoreFromEarmark(earmarkServicesPct: number): number {
  const earmark = clamp(earmarkServicesPct, PROPERTY_TAX_EARMARK_MIN, PROPERTY_TAX_EARMARK_MAX);
  const t = earmark / PROPERTY_TAX_EARMARK_MAX;
  return Math.round(SOCIAL_AT_ZERO_EARMARK + t * (SOCIAL_AT_FULL_EARMARK - SOCIAL_AT_ZERO_EARMARK));
}

/** Pure scoring for property tax ordinances — no side effects. */
export function scoreOrdinance(stanceParams: PropertyTaxStanceParams): OrdinanceIssueScores {
  const params = clampPropertyTaxStanceParams(stanceParams);
  return {
    issue_economic_score: economicScoreFromRateDelta(params.rate_delta),
    issue_social_score: socialScoreFromEarmark(params.earmark_services_pct),
  };
}

/**
 * Maps continuous economic score to caucus lane for _npc_ideology_vote shortcuts.
 * Mirrors SQL `_property_tax_coalition_key`.
 */
export function derivePropertyTaxCoalitionKey(
  issueEconomicScore: number,
): OrdinanceStanceKey | null {
  if (issueEconomicScore <= -15) return "progressive";
  if (issueEconomicScore >= 20) return "conservative";
  if (Math.abs(issueEconomicScore) <= 15) return "moderate";
  return null;
}

export function isPropertyTaxIssue(issueKey: string): boolean {
  return issueKey.toLowerCase().trim() === "property_tax_rate";
}

export function formatPropertyTaxRateDelta(rateDelta: number): string {
  if (Math.abs(rateDelta) < 0.05) return "hold steady";
  const sign = rateDelta > 0 ? "+" : "";
  return `${sign}${rateDelta.toFixed(1)} pp`;
}

export function buildPropertyTaxOrdinanceTitle(params: PropertyTaxStanceParams): string {
  const p = clampPropertyTaxStanceParams(params);
  const rateLabel = formatPropertyTaxRateDelta(p.rate_delta);
  return `Property Tax Rate Adjustment — ${rateLabel}, ${Math.round(p.earmark_services_pct)}% services earmark`;
}

export function buildPropertyTaxOrdinanceSummary(params: PropertyTaxStanceParams): string {
  const p = clampPropertyTaxStanceParams(params);
  const ratePhrase =
    Math.abs(p.rate_delta) < 0.05
      ? "hold the levy flat"
      : p.rate_delta > 0
        ? `raise the property tax rate by ${p.rate_delta.toFixed(1)} percentage points`
        : `cut the property tax rate by ${Math.abs(p.rate_delta).toFixed(1)} percentage points`;
  const earmarkPhrase =
    p.earmark_services_pct >= 75
      ? "earmark most new or retained revenue for sanitation, snow removal, and core services"
      : p.earmark_services_pct <= 25
        ? "route most revenue relief to the general fund and homeowner relief"
        : `split revenue about ${Math.round(p.earmark_services_pct)}% to services and the rest to general fund or relief`;
  return `Sets the annual property tax levy for NYC homeowners and small landlords. This filing would ${ratePhrase} and ${earmarkPhrase}.`;
}
