/**
 * PAC corruption economy display constants.
 * Authoritative rules live in Postgres (`_pac_tier_*`, contribution RPCs).
 */
export const PAC_LEVEL_1_COST = 5_000_000;
export const PAC_LEVEL_2_UPGRADE_COST = 20_000_000;
export const PAC_LEVEL_3_UPGRADE_COST = 50_000_000;

export const PAC_HOURLY_BY_TIER: Record<1 | 2 | 3, number> = {
  1: 300_000,
  2: 500_000,
  3: 1_000_000,
};

export const PAC_TREASURY_CAP_BY_TIER: Record<1 | 2 | 3, number> = {
  1: 10_000_000,
  2: 50_000_000,
  3: 200_000_000,
};

export const PAC_LEGAL_CAP_BY_TIER: Record<1 | 2 | 3, number> = {
  1: 500_000,
  2: 2_000_000,
  3: 5_000_000,
};

/** 1 campaign point per $100K disclosed (legal). */
export const PAC_LEGAL_POINTS_PER_100K = 1;

export const PAC_MIN_CONTRIBUTION = 100_000;

export const PAC_ILLEGAL_MULTIPLIERS = {
  strategy: 2.0,
  exceed_cap: 2.5,
  conceal_source: 2.5,
} as const;

export type PacCoordinationType = keyof typeof PAC_ILLEGAL_MULTIPLIERS;

export const INVESTIGATION_COST = 500_000;
export const INVESTIGATION_COOLDOWN_HOURS = 24;

export const INDUSTRY_SECTORS = [
  { key: "defense", label: "Defense & Aerospace" },
  { key: "energy", label: "Energy & Utilities" },
  { key: "healthcare", label: "Healthcare & Pharma" },
  { key: "finance", label: "Finance & Banking" },
  { key: "tech", label: "Technology & Telecom" },
] as const;
