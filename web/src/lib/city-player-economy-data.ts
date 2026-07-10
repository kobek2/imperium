import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayerBusinessActivitySnapshot } from "@/lib/city-player-business-activity";
import type { PlayerEconomySnapshot } from "@/lib/city-player-economy-revenue";

function parseBusinessActivity(raw: Record<string, unknown> | undefined): PlayerBusinessActivitySnapshot {
  return {
    windowDays: Number(raw?.window_days ?? 90),
    annualizedVolumeUsd: Number(raw?.annualized_volume_usd ?? 0),
    activePlayers: Number(raw?.active_players ?? 0),
    qualifyingTransactions: Number(raw?.qualifying_transactions ?? 0),
    walletBalanceSumUsd: Number(raw?.wallet_balance_sum_usd ?? 0),
  };
}

export async function loadPlayerEconomySnapshot(
  supabase: SupabaseClient,
  windowDays = 90,
): Promise<PlayerEconomySnapshot | null> {
  const { data, error } = await supabase.rpc("get_city_player_economy_snapshot", {
    p_window_days: windowDays,
  });
  if (error) {
    console.warn("[city-player-economy] snapshot:", error.message);
    return null;
  }
  const raw = data as Record<string, unknown> | null;
  if (!raw?.ok) return null;

  return {
    windowDays: Number(raw.window_days ?? windowDays),
    walletBalanceSumUsd: Number(raw.wallet_balance_sum_usd ?? 0),
    walletPlayerCount: Number(raw.wallet_player_count ?? 0),
    annualizedWageUsd: Number(raw.annualized_wage_usd ?? 0),
    wagePlayerCount: Number(raw.wage_player_count ?? 0),
    wageTransactions: Number(raw.wage_transactions ?? 0),
    businessActivity: parseBusinessActivity(raw.business_activity as Record<string, unknown> | undefined),
  };
}
