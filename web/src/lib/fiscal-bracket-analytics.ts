import type { FiscalTaxBracket } from "@/lib/fiscal-tax";

export type BracketBandStat = {
  bandIndex: number;
  ceiling: number | null;
  rate: number;
  /** Total dollars of income falling in this marginal slice (all players). */
  aggregateIncomeInBand: number;
  /** Tax revenue attributed to this band (sum of slice × rate per player). */
  revenueFromBand: number;
  /** Players with any positive income taxed in this band. */
  playersInBand: number;
};

/** Split one income across marginal bands (same logic as tax). */
function marginalSlices(income: number, brackets: FiscalTaxBracket[]): number[] {
  if (!Number.isFinite(income) || income <= 0) {
    return brackets.map(() => 0);
  }
  const slices = new Array<number>(brackets.length).fill(0);
  let prevTop = 0;
  for (let i = 0; i < brackets.length; i++) {
    const top = brackets[i]!.ceiling == null ? null : Number(brackets[i]!.ceiling);
    if (top == null) {
      slices[i] = Math.max(0, income - prevTop);
      break;
    }
    const width = Math.max(0, Math.min(income, top) - prevTop);
    slices[i] = width;
    prevTop = top;
    if (income <= top) break;
  }
  return slices;
}

/**
 * Aggregate marginal-band analytics for a population's taxable income amounts
 * (e.g. each player's FY-to-date `hourly_income` total for previews, or full-year totals after close).
 * `brackets` must match the active federal budget (same order as tax).
 */
export function computeMarginalBracketAnalytics(
  annualIncomes: number[],
  brackets: FiscalTaxBracket[],
): { bands: BracketBandStat[]; totalIncome: number; totalTax: number; playerCountWithIncome: number } {
  const bands: BracketBandStat[] = brackets.map((b, bandIndex) => ({
    bandIndex,
    ceiling: b.ceiling == null ? null : Number(b.ceiling),
    rate: Number(b.rate) || 0,
    aggregateIncomeInBand: 0,
    revenueFromBand: 0,
    playersInBand: 0,
  }));

  let totalIncome = 0;
  let totalTax = 0;
  const playerCountWithIncome = annualIncomes.filter((x) => x > 0).length;

  for (const raw of annualIncomes) {
    const income = Number(raw) || 0;
    if (income <= 0) continue;
    totalIncome += income;
    const slices = marginalSlices(income, brackets);
    for (let i = 0; i < bands.length; i++) {
      const slice = slices[i] ?? 0;
      const r = bands[i]!.rate;
      bands[i]!.aggregateIncomeInBand += slice;
      bands[i]!.revenueFromBand += slice * r;
      if (slice > 0) bands[i]!.playersInBand += 1;
      totalTax += slice * r;
    }
  }

  for (const b of bands) {
    b.revenueFromBand = Math.round(b.revenueFromBand * 100) / 100;
    b.aggregateIncomeInBand = Math.round(b.aggregateIncomeInBand * 100) / 100;
  }
  totalTax = Math.round(totalTax * 100) / 100;

  return { bands, totalIncome, totalTax, playerCountWithIncome };
}
