/**
 * Display copy for the economy UI. Authoritative payout rules live in Postgres
 * (`_economy_hourly_from_roles`, `economy_collect_income(p_body)`, PAC RPCs) — keep numbers aligned when tuning.
 */
export const ECONOMY_CITIZEN_HOURLY = 5_000;
export const ECONOMY_REPRESENTATIVE_HOURLY = 142_000;
export const ECONOMY_SPEAKER_ADDON_HOURLY = 90_000;
export const ECONOMY_SENATOR_HOURLY = 165_000;
export const ECONOMY_PRESIDENT_ADDON_HOURLY = 400_000;
export const ECONOMY_VP_ADDON_HOURLY = 230_000;

/** Capped accrual window (matches Postgres `economy_collect_income`). */
export const ECONOMY_MAX_OFFLINE_HOURS = 24;

export const CAMPAIGN_AD_UNIT_PRICE = 1_000_000;
export const CAMPAIGN_AD_POINTS = 1;

export const PAC_LEVEL_1_COST = 5_000_000;
export const PAC_LEVEL_2_UPGRADE_COST = 20_000_000;
export const PAC_LEVEL_3_UPGRADE_COST = 50_000_000;
export const PAC_HOURLY_BY_LEVEL: Record<1 | 2 | 3, number> = {
  1: 300_000,
  2: 500_000,
  3: 1_000_000,
};

/** Table stakes for house blackjack (matches Postgres `economy_blackjack_start`). */
export const GAMBLE_BLACKJACK_MIN = 1_000;
