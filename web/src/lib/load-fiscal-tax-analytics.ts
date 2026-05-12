import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMissingPostgrestRpcError,
  loadScheduledHourlyGrossWithoutRpc,
} from "@/lib/economy-scheduled-hourly";
import { computeMarginalBracketAnalytics } from "@/lib/fiscal-bracket-analytics";
import type { FiscalTaxBracket } from "@/lib/fiscal-tax";

/**
 * Per-user **salary / PAC collect** totals (`hourly_income` only) between `fiscalYearStartedAt` (inclusive)
 * and `windowEndAt` (inclusive). When `windowEndAt` is null, uses "now" (FY-to-date for the active year).
 */
export async function loadAnnualInflowsForFiscalYearWindow(
  supabase: SupabaseClient,
  fiscalYearStartedAt: string,
  windowEndAt: string | null,
): Promise<number[]> {
  const endIso = windowEndAt?.trim() ? windowEndAt : new Date().toISOString();
  const { data, error } = await supabase
    .from("economy_ledger")
    .select("wallet_user_id, delta")
    .eq("kind", "hourly_income")
    .gt("delta", 0)
    .gte("created_at", fiscalYearStartedAt)
    .lte("created_at", endIso);

  if (error) throw new Error(error.message);

  const byUser = new Map<string, number>();
  for (const row of data ?? []) {
    const id = (row as { wallet_user_id: string }).wallet_user_id;
    const d = Number((row as { delta: number }).delta);
    byUser.set(id, (byUser.get(id) ?? 0) + d);
  }
  return [...byUser.values()];
}

/** Active fiscal year: from FY start through the current instant (`lte` end bound). */
export async function loadAnnualInflowsForFiscalYear(
  supabase: SupabaseClient,
  fiscalYearStartedAt: string,
): Promise<number[]> {
  return loadAnnualInflowsForFiscalYearWindow(supabase, fiscalYearStartedAt, null);
}

/**
 * One value per profile: scheduled `hourly_income` gross (role salary + PAC) for a single sim-hour collect,
 * matching `economy_collect_income` before the elapsed-hours multiplier.
 *
 * Uses RPC `fiscal_list_player_scheduled_hourly_gross` when present (full PAC visibility via SECURITY DEFINER).
 * If the migration is not applied yet, falls back to the same formula from `profiles` + `government_role_grants`
 * + visible `economy_pacs` rows (PAC may be incomplete for callers who are not economy staff auditors).
 */
export async function loadScheduledHourlyGrossForAllProfiles(supabase: SupabaseClient): Promise<number[]> {
  const { data, error } = await supabase.rpc("fiscal_list_player_scheduled_hourly_gross");
  if (!error && data != null) {
    const rows = data as Array<{ hourly_gross?: unknown }>;
    return rows.map((row) => Number(row.hourly_gross ?? 0));
  }
  if (error && !isMissingPostgrestRpcError(error)) {
    throw new Error(error.message);
  }
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console -- migration hint for local / preview DBs
    console.warn(
      "[federal budget] fiscal_list_player_scheduled_hourly_gross RPC missing; using client role+PAC preview. Apply supabase/migrations/20260511200000_fiscal_scheduled_hourly_gross_preview_rpc.sql for full PAC coverage.",
    );
  }
  return loadScheduledHourlyGrossWithoutRpc(supabase);
}

export function buildBracketAnalytics(
  annualIncomes: number[],
  brackets: FiscalTaxBracket[],
) {
  return computeMarginalBracketAnalytics(annualIncomes, brackets);
}
