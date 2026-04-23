import type { SupabaseClient } from "@supabase/supabase-js";
import { computeMarginalBracketAnalytics } from "@/lib/fiscal-bracket-analytics";
import type { FiscalTaxBracket } from "@/lib/fiscal-tax";

/**
 * Per-user **salary / PAC collect** totals (`hourly_income` only) between `fiscalYearStartedAt` (inclusive)
 * and `windowEndAt` (inclusive). When `windowEndAt` is null, uses "now" (active fiscal year YTD).
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

/** Active fiscal year: from FY start through the current instant (exclusive upper bound in prior impl → use lte now). */
export async function loadAnnualInflowsForFiscalYear(
  supabase: SupabaseClient,
  fiscalYearStartedAt: string,
): Promise<number[]> {
  return loadAnnualInflowsForFiscalYearWindow(supabase, fiscalYearStartedAt, null);
}

export function buildBracketAnalytics(
  annualIncomes: number[],
  brackets: FiscalTaxBracket[],
) {
  return computeMarginalBracketAnalytics(annualIncomes, brackets);
}
