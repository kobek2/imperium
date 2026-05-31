import type { SupabaseClient } from "@supabase/supabase-js";
import { CAMPAIGN_AD_POINTS, CAMPAIGN_AD_UNIT_PRICE } from "@/lib/economy-config";

const PAGE = 1000;

/** Each inventory ad spent adds this many `campaign_ads.points` (see `economy_use_campaign_ad`). */
export { CAMPAIGN_AD_UNIT_PRICE, CAMPAIGN_AD_POINTS };

/** @deprecated Use {@link campaignAdSpendUsd} — kept for imports during rename. */
export const CAMPAIGN_AD_LIST_PRICE_USD = CAMPAIGN_AD_UNIT_PRICE;

/** Wallet spend for ads placed in a race: one point in DB ≈ one $1M ad. */
export function campaignAdSpendUsd(totalPoints: number): number {
  const ads = Math.max(0, Math.round(totalPoints / CAMPAIGN_AD_POINTS));
  return ads * CAMPAIGN_AD_UNIT_PRICE;
}

/** @deprecated Alias for {@link campaignAdSpendUsd}. */
export const campaignAdListPriceSpendUsd = campaignAdSpendUsd;

export function campaignAdCountFromPoints(totalPoints: number): number {
  return Math.max(0, Math.round(totalPoints / CAMPAIGN_AD_POINTS));
}

export function formatCampaignAdSpendUsd(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(usd);
}

/** Sum `campaign_ads.points` for an election (PostgREST max 1000 rows per request — page if needed). */
export async function sumCampaignAdPointsForElection(
  supabase: SupabaseClient,
  electionId: string,
): Promise<number> {
  let total = 0;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("campaign_ads")
      .select("points")
      .eq("election_id", electionId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return total;
    const rows = (data ?? []) as Array<{ points: number | null }>;
    for (const r of rows) total += Number(r.points ?? CAMPAIGN_AD_POINTS);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return total;
}
