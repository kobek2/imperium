/**
 * Display copy for the economy UI. Authoritative payout rules live in Postgres.
 */
export const ECONOMY_CITIZEN_HOURLY = 5_000;
export const ECONOMY_REPRESENTATIVE_HOURLY = 142_000;
export const ECONOMY_SPEAKER_ADDON_HOURLY = 90_000;
export const ECONOMY_SENATOR_HOURLY = 165_000;
export const ECONOMY_PRESIDENT_ADDON_HOURLY = 400_000;
export const ECONOMY_VP_ADDON_HOURLY = 230_000;

export const ECONOMY_MAX_OFFLINE_HOURS = 24;

export const PAC_REGISTER_COST = 75_000_000;
export const PAC_LEGAL_CAP_PER_CANDIDATE = 10_000_000;
/** Disclosed PAC spending converts to campaign points at this rate (rounded down). */
export const PAC_DOLLARS_PER_POINT = 250_000;
/** @deprecated Use PAC_DOLLARS_PER_POINT */
export const PAC_LEGAL_POINTS_PER_500K = 1;
export const PAC_MIN_CONTRIBUTION = 100_000;
export const PAC_MIN_FOR_ONE_POINT = PAC_DOLLARS_PER_POINT;

export function pacCampaignPointsFromAmount(amount: number): number {
  return Math.floor(Math.max(0, amount) / PAC_DOLLARS_PER_POINT);
}

/** One-time incorporation / IPO preparation fee (deducted from wallet). */
export const STOCK_FOUNDING_FEE = 100_000_000;
/** @deprecated Use STOCK_FOUNDING_FEE */
export const STOCK_FOUNDING_MIN_CAPITAL = STOCK_FOUNDING_FEE;
export const STOCK_MIN_VALUATION = 1_000_000;
export const STOCK_MIN_TOTAL_SHARES = 1_000;
export const STOCK_DISCLOSURE_PCT = 5;
export const STOCK_PREMIUM_MIN = 0.25;
export const STOCK_PREMIUM_MAX = 4.0;
export const STOCK_TRADE_PREMIUM_PER_100_SHARES = 0.005;

export const COMPANY_STRATEGIES = [
  {
    key: "growth",
    label: "Growth",
    description: "10% hourly revenue growth — higher volatility on share price swings.",
  },
  {
    key: "stable",
    label: "Stable",
    description: "3% hourly revenue growth — lower volatility, predictable movement.",
  },
  {
    key: "market_expansion",
    label: "Market Expansion",
    description: "6% hourly revenue growth (+15% competitive bonus) — built to win sector share.",
  },
] as const;

export const CAMPAIGN_AD_TYPES = {
  persuasion: { cost: 1_000_000, points: 3, label: "Persuasion Ad" },
  attack: { cost: 1_500_000, points: 0, targetPenalty: 4, label: "Attack Ad", successRate: 0.65 },
} as const;

export type CampaignAdType = keyof typeof CAMPAIGN_AD_TYPES;

/** @deprecated Use CAMPAIGN_AD_TYPES */
export const CAMPAIGN_AD_UNIT_PRICE = CAMPAIGN_AD_TYPES.persuasion.cost;
/** @deprecated Use CAMPAIGN_AD_TYPES */
export const CAMPAIGN_AD_POINTS = CAMPAIGN_AD_TYPES.persuasion.points;

export const GAMBLE_BLACKJACK_MIN = 1_000;

export const BUSINESS_SECTORS = [
  { key: "defense", label: "Defense" },
  { key: "energy", label: "Energy" },
  { key: "finance", label: "Finance" },
  { key: "healthcare", label: "Healthcare" },
  { key: "tech", label: "Technology" },
  { key: "media", label: "Media" },
  { key: "real_estate", label: "Real Estate" },
  { key: "agriculture", label: "Agriculture" },
] as const;
