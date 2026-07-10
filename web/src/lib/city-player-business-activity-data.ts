import type { SupabaseClient } from "@supabase/supabase-js";
import {
  logBusinessTaxRevenueComparison,
  type BusinessTaxRevenueResolution,
  type PlayerBusinessActivitySnapshot,
} from "@/lib/city-player-business-activity";

export type BusinessTaxRefreshResult = BusinessTaxRevenueResolution & {
  ok: boolean;
};

function parseActivitySnapshot(raw: Record<string, unknown> | null | undefined): PlayerBusinessActivitySnapshot {
  return {
    windowDays: Number(raw?.window_days ?? 90),
    annualizedVolumeUsd: Number(raw?.annualized_volume_usd ?? 0),
    activePlayers: Number(raw?.active_players ?? 0),
    qualifyingTransactions: Number(raw?.qualifying_transactions ?? 0),
    walletBalanceSumUsd: Number(raw?.wallet_balance_sum_usd ?? 0),
  };
}

export async function refreshCityBusinessTaxRevenue(
  supabase: SupabaseClient,
  cityCode = "MB",
): Promise<BusinessTaxRefreshResult | null> {
  const { data, error } = await supabase.rpc("refresh_city_business_tax_revenue", {
    p_city_code: cityCode,
  });
  if (error) {
    console.warn("[city-business-tax] refresh:", error.message);
    return null;
  }

  const raw = data as Record<string, unknown> | null;
  if (!raw?.ok) return null;

  const result: BusinessTaxRefreshResult = {
    ok: true,
    revenueMillions: Number(raw.business_tax_revenue_millions ?? 0),
    source: raw.source === "activity" ? "activity" : "placeholder",
    placeholderMillions: Number(raw.placeholder_millions ?? 0),
    activityMillions: Number(raw.activity_millions ?? 0),
    meaningfulActivity: Boolean(raw.meaningful_activity),
    activity: parseActivitySnapshot(raw.activity as Record<string, unknown> | undefined),
  };

  logBusinessTaxRevenueComparison(result);
  return result;
}

export async function loadPlayerBusinessActivitySnapshot(
  supabase: SupabaseClient,
  windowDays = 90,
): Promise<PlayerBusinessActivitySnapshot | null> {
  const { data, error } = await supabase.rpc("get_city_player_business_activity", {
    p_window_days: windowDays,
  });
  if (error) return null;
  const raw = data as Record<string, unknown> | null;
  if (!raw?.ok) return null;
  return parseActivitySnapshot(raw);
}
