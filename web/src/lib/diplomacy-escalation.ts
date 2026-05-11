/**
 * Derive RP-facing escalation labels from State's 0–100 bilateral scale (higher = warmer ties).
 */

export type EscalationTier = "stable" | "strained" | "critical" | "breakdown";

export function usRelationToTier(usRelation: number): EscalationTier {
  const r = Math.round(Number(usRelation));
  if (r <= 10) return "breakdown";
  if (r <= 30) return "critical";
  if (r <= 70) return "strained";
  return "stable";
}

/** 0 = low pressure (strong ties), 100 = high pressure (near breakdown). */
export function escalationHeat(usRelation: number): number {
  return Math.max(0, Math.min(100, 100 - Math.round(Number(usRelation))));
}

const TIER_LABEL: Record<EscalationTier, string> = {
  stable: "Stable",
  strained: "Strained",
  critical: "Critical",
  breakdown: "Breakdown risk",
};

export function tierLabel(tier: EscalationTier): string {
  return TIER_LABEL[tier];
}

/** HSL background for heat bars (green → amber → red). */
export function heatBarBackgroundFromRelation(usRelation: number): string {
  const heat = escalationHeat(usRelation) / 100;
  const hue = Math.round(118 - heat * 118);
  const sat = 55 + Math.round(heat * 18);
  const light = Math.round(46 - heat * 10);
  return `hsl(${hue} ${sat}% ${light}%)`;
}
