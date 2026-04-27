/** Surplus over minimum spend → “improvement tiers” for linked national metrics (display). */
const SURPLUS_PER_TIER = 500_000;
const MAX_GDP_INDEX_RATIO = 4;

export function surplusAboveMinimum(allocated: number, minimum: number): number {
  const a = Number(allocated) || 0;
  const m = Number(minimum) || 0;
  return Math.max(0, a - m);
}

export function budgetSurplusTiers(surplus: number): { tiers: number; summary: string } {
  if (surplus <= 0) {
    return { tiers: 0, summary: "No change — spending matches minimum (baseline only)." };
  }
  const tiers = Math.max(1, Math.ceil(surplus / SURPLUS_PER_TIER));
  return {
    tiers,
    summary: `+${tiers} improvement tier(s) toward linked national metrics (vs minimum). ~$${SURPLUS_PER_TIER.toLocaleString()} per tier.`,
  };
}

/** Human-readable mapping for Congress / players (manual). */
export const LINE_ITEM_METRIC_FOCUS: Record<string, string> = {
  infrastructure: "Infrastructure: roads, congestion",
  education: "Education: scores, dropout, enrollment",
  healthcare: "Healthcare: coverage, life expectancy",
  defense: "Defense & security",
  social_welfare: "Poverty, welfare, housing",
  environment: "Environment (use national metrics manually)",
  economic_development: "Economy: jobs, unemployment, income",
  science_tech: "R&D / long-term indicators",
  foreign_aid: "Diplomacy (narrative)",
  relief: "Emergency relief capacity",
};

export function lineItemFocus(key: string): string {
  return LINE_ITEM_METRIC_FOCUS[key] ?? "National metrics (see National metrics page)";
}

/** Display titles for federal budget line keys (matches seeded `federal_budgets.line_items`). */
export const LINE_ITEM_DEFAULT_LABELS: Record<string, string> = {
  infrastructure: "Infrastructure and Transportation",
  education: "Education",
  healthcare: "Healthcare",
  defense: "Defense and National Security",
  social_welfare: "Social Welfare Programs",
  environment: "Environmental Protection",
  economic_development: "Economic Development and Job Creation",
  science_tech: "Science and Technology Research",
  foreign_aid: "Foreign Aid and Diplomacy",
  relief: "Relief Funds",
};

export function lineItemDefaultLabel(key: string): string {
  const k = String(key ?? "").trim();
  if (LINE_ITEM_DEFAULT_LABELS[k]) return LINE_ITEM_DEFAULT_LABELS[k]!;
  if (!k) return "Line item";
  return k
    .split("_")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
    .filter(Boolean)
    .join(" ");
}

/** Wallet-sum index versus fiscal-year opening GDP (non-decreasing, capped). */
export function computeServerGdpIndexRatio(walletTotal: number, gdpOpeningTotal: number | null): number {
  const w = Number(walletTotal);
  const g = Number(gdpOpeningTotal ?? 0);
  if (!Number.isFinite(w) || !Number.isFinite(g) || g <= 0) return 1;
  return Math.max(1, Math.min(w / g, MAX_GDP_INDEX_RATIO));
}
