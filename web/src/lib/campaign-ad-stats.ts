import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE = 1000;

/** Must match `unit_price` in `public.economy_buy_campaign_ads` (migrations). */
export const CAMPAIGN_AD_LIST_PRICE_USD = 50_000;

export function campaignAdListPriceSpendUsd(totalPoints: number): number {
  return Math.max(0, Math.round(totalPoints)) * CAMPAIGN_AD_LIST_PRICE_USD;
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
    for (const r of rows) total += Number(r.points ?? 1);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return total;
}
