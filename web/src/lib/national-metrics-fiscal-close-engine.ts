/**
 * Documents how `fiscal_close_year()` reshapes `national_metrics` when a year closes.
 * The authoritative implementation is SQL (`supabase/migrations/20260507103000_fiscal_allow_admin_budget_ops.sql`);
 * keep this file in sync when that logic changes.
 *
 * **Funding ratio** `r = min(1, tax_collected_total / max(1, appropriations_total))` — how much of enacted spend was
 * covered by cash tax collected at close (not assessed).
 *
 * **Carry-forward (simplified):** each stored metric is pulled toward “stress” when `r` is low (approval scaled by `r`,
 * unemployment rises with `(1-r)*5`, poverty and crime drift up, infrastructure congestion rises, etc.). High `r`
 * preserves more of the prior year’s social and macro posture.
 *
 * **Economy speed:** `rp_fiscal_years.gdp_closing_total` snapshots wallet-sum GDP at close; the new year opens with
 * `gdp_opening_total` reset to the same wallet sum so bracket analytics and line-minimum inflation use current player
 * wealth velocity.
 */

export function describeFundingRatio(r: number): string {
  const x = Math.max(0, Math.min(1, Number(r) || 0));
  if (x >= 0.98) return "Strong funding — national metrics carry forward with only light stress adjustments.";
  if (x >= 0.85) return "Moderate funding gap — expect mixed pressure on social and macro indicators in the new year.";
  return "Severe funding shortfall — metrics shift toward stress in the automated carry-forward.";
}
