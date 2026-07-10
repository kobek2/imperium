/**
 * Player wallet / ledger activity → city business tax revenue input layer.
 * Uses existing economy_ledger kinds only — no new player action types.
 */

export const BUSINESS_TAX_GROWTH_CONSTANT = 0.000014;

export const BUSINESS_TAX_ACTIVITY_WINDOW_DAYS = 90;

/** Minimum signal before we trust activity over the population placeholder. */
export const BUSINESS_TAX_MIN_ACTIVE_PLAYERS = 3;
export const BUSINESS_TAX_MIN_QUALIFYING_TRANSACTIONS = 12;
export const BUSINESS_TAX_MIN_ANNUALIZED_VOLUME_USD = 5_000_000;

/** Reference active-player count for sublinear scaling (sqrt curve). */
export const BUSINESS_TAX_REFERENCE_ACTIVE_PLAYERS = 12;

/** Annualized qualifying volume that yields ~1× placeholder before player scale. */
export const BUSINESS_TAX_ANNUALIZED_VOLUME_FOR_PARITY_USD = 2_000_000_000;

/** Cap activity-driven revenue vs placeholder during transition. */
export const BUSINESS_TAX_ACTIVITY_MULTIPLIER_CAP = 2.5;

/**
 * Voluntary commercial / market activity — excludes passive income, levies, and
 * city office salary (separate city revenue stream).
 */
export const QUALIFYING_BUSINESS_LEDGER_KINDS = [
  "transfer_in",
  "transfer_out",
  "campaign_ad",
  "campaign_ad_buy",
  "campaign_ad_spend",
  "business_investment",
  "found_business",
  "pac_purchase",
  "pac_upgrade",
  "pac_deposit",
  "pac_treasury_deposit",
  "gamble_blackjack",
  "investigation",
  "corruption",
  "party_deposit",
] as const;

export type QualifyingBusinessLedgerKind = (typeof QUALIFYING_BUSINESS_LEDGER_KINDS)[number];

export type PlayerBusinessActivitySnapshot = {
  windowDays: number;
  annualizedVolumeUsd: number;
  activePlayers: number;
  qualifyingTransactions: number;
  walletBalanceSumUsd: number;
};

export type BusinessTaxRevenueResolution = {
  /** Value persisted to business_tax_revenue_millions — same range as placeholder. */
  revenueMillions: number;
  source: "activity" | "placeholder";
  placeholderMillions: number;
  activityMillions: number;
  activity: PlayerBusinessActivitySnapshot;
  meaningfulActivity: boolean;
};

export function computePlaceholderBusinessTaxRevenueMillions(
  population: number,
  approvalRating: number,
  growthConstant: number,
): number {
  if (population <= 0) return 0;
  const approvalFactor = Math.max(0, Math.min(1, approvalRating / 100));
  const annualDollars = population * approvalFactor * growthConstant * population;
  return annualDollars / 1_000_000;
}

export function isMeaningfulBusinessActivity(activity: PlayerBusinessActivitySnapshot): boolean {
  return (
    activity.activePlayers >= BUSINESS_TAX_MIN_ACTIVE_PLAYERS &&
    activity.qualifyingTransactions >= BUSINESS_TAX_MIN_QUALIFYING_TRANSACTIONS &&
    activity.annualizedVolumeUsd >= BUSINESS_TAX_MIN_ANNUALIZED_VOLUME_USD
  );
}

/**
 * Sublinear player scaling: sqrt(active / reference), clamped so 5 vs 50 players stay sane.
 * 5 → ~0.65, 12 → 1.0, 50 → ~1.4 (capped).
 */
export function businessTaxPlayerScale(activePlayers: number): number {
  if (activePlayers <= 0) return 0;
  const raw = Math.sqrt(activePlayers / BUSINESS_TAX_REFERENCE_ACTIVE_PLAYERS);
  return Math.max(0.55, Math.min(1.45, raw));
}

/**
 * Map annualized qualifying ledger volume to millions USD business tax revenue,
 * anchored to the placeholder at parity volume.
 */
export function computeActivityBusinessTaxRevenueMillions(
  placeholderMillions: number,
  activity: PlayerBusinessActivitySnapshot,
): number {
  if (placeholderMillions <= 0 || activity.annualizedVolumeUsd <= 0) return 0;

  const volumeRatio =
    activity.annualizedVolumeUsd / BUSINESS_TAX_ANNUALIZED_VOLUME_FOR_PARITY_USD;
  const playerScale = businessTaxPlayerScale(activity.activePlayers);
  const multiplier = Math.min(BUSINESS_TAX_ACTIVITY_MULTIPLIER_CAP, volumeRatio * playerScale);

  return placeholderMillions * multiplier;
}

export function resolveBusinessTaxRevenueMillions(input: {
  population: number;
  approvalRating: number;
  growthConstant: number;
  activity: PlayerBusinessActivitySnapshot;
}): BusinessTaxRevenueResolution {
  const placeholderMillions = computePlaceholderBusinessTaxRevenueMillions(
    input.population,
    input.approvalRating,
    input.growthConstant,
  );
  const activityMillions = computeActivityBusinessTaxRevenueMillions(
    placeholderMillions,
    input.activity,
  );
  const meaningfulActivity = isMeaningfulBusinessActivity(input.activity);

  return {
    revenueMillions: meaningfulActivity ? activityMillions : placeholderMillions,
    source: meaningfulActivity ? "activity" : "placeholder",
    placeholderMillions,
    activityMillions,
    activity: input.activity,
    meaningfulActivity,
  };
}

/** Preserved 3-arg entry point — uses placeholder unless activity is passed. */
export function computeBusinessTaxRevenueMillions(
  population: number,
  approvalRating: number,
  growthConstant: number = BUSINESS_TAX_GROWTH_CONSTANT,
  activity?: PlayerBusinessActivitySnapshot | null,
): number {
  if (!activity) {
    return computePlaceholderBusinessTaxRevenueMillions(population, approvalRating, growthConstant);
  }
  return resolveBusinessTaxRevenueMillions({
    population,
    approvalRating,
    growthConstant,
    activity,
  }).revenueMillions;
}

export function logBusinessTaxRevenueComparison(resolution: BusinessTaxRevenueResolution): void {
  if (process.env.NODE_ENV === "production") return;
  // eslint-disable-next-line no-console
  console.info("[city-business-tax]", {
    source: resolution.source,
    revenueMillions: Number(resolution.revenueMillions.toFixed(3)),
    placeholderMillions: Number(resolution.placeholderMillions.toFixed(3)),
    activityMillions: Number(resolution.activityMillions.toFixed(3)),
    activePlayers: resolution.activity.activePlayers,
    qualifyingTransactions: resolution.activity.qualifyingTransactions,
    annualizedVolumeUsd: Math.round(resolution.activity.annualizedVolumeUsd),
    windowDays: resolution.activity.windowDays,
  });
}
