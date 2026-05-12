import type { BracketBandStat } from "@/lib/fiscal-bracket-analytics";

export function TaxBracketAnalyticsTable({
  bands,
  totalIncome,
  totalTax,
  totalsFootnote,
  incomeColumnLabel = "Income in band",
  revenueColumnLabel = "Revenue from band",
  /** When set (e.g. 72), adds RP-year-scaled salary + tax columns; bracket math stays hourly. */
  rpYearSimHoursMultiplier,
}: {
  bands: BracketBandStat[];
  totalIncome: number;
  totalTax: number;
  /** Explains what “income” and the player count represent (e.g. hourly vs closed-year ledger). */
  totalsFootnote: string;
  /** Table header for the income column (e.g. est. annual vs closed-year actual). */
  incomeColumnLabel?: string;
  revenueColumnLabel?: string;
  rpYearSimHoursMultiplier?: number;
}) {
  const m = rpYearSimHoursMultiplier;
  const showRpYear = m != null && Number.isFinite(m) && m > 0;
  const totalGrossRp = showRpYear ? totalIncome * m : null;
  const totalTaxRp = showRpYear ? totalTax * m : null;

  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-left text-sm ${showRpYear ? "min-w-[980px]" : "min-w-[720px]"}`}>
        <thead>
          <tr className="border-b border-[var(--psc-border)] text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
            <th className="py-2 pr-2">Band</th>
            <th className="py-2 pr-2">Ceiling</th>
            <th className="py-2 pr-2">Rate</th>
            <th className="py-2 pr-2">Players w/ slice here</th>
            {showRpYear ? (
              <>
                <th className="py-2 pr-2">Hourly income in band</th>
                <th className="py-2 pr-2">Est. RP-year gross (×{m})</th>
                <th className="py-2">Est. RP-year tax (×{m})</th>
              </>
            ) : (
              <>
                <th className="py-2 pr-2">{incomeColumnLabel}</th>
                <th className="py-2">{revenueColumnLabel}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {bands.map((b) => (
            <tr key={b.bandIndex} className="border-b border-[var(--psc-border)]/60">
              <td className="py-2 pr-2 font-mono text-xs">{b.bandIndex + 1}</td>
              <td className="py-2 pr-2 font-mono text-xs">
                {b.ceiling == null ? "∞ (top)" : `$${Number(b.ceiling).toLocaleString()}`}
              </td>
              <td className="py-2 pr-2 font-mono">{(b.rate * 100).toFixed(2)}%</td>
              <td className="py-2 pr-2 font-mono tabular-nums">{b.playersInBand}</td>
              {showRpYear ? (
                <>
                  <td className="py-2 pr-2 font-mono tabular-nums">${b.aggregateIncomeInBand.toLocaleString()}</td>
                  <td className="py-2 pr-2 font-mono tabular-nums">
                    ${(b.aggregateIncomeInBand * m).toLocaleString()}
                  </td>
                  <td className="py-2 font-mono tabular-nums text-emerald-800">
                    ${(b.revenueFromBand * m).toLocaleString()}
                  </td>
                </>
              ) : (
                <>
                  <td className="py-2 pr-2 font-mono tabular-nums">${b.aggregateIncomeInBand.toLocaleString()}</td>
                  <td className="py-2 font-mono tabular-nums text-emerald-800">${b.revenueFromBand.toLocaleString()}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--psc-border)] font-semibold text-[var(--psc-ink)]">
            <td className="py-2 pr-2" colSpan={3}>
              Totals ({totalsFootnote})
            </td>
            <td className="py-2 pr-2">—</td>
            {showRpYear ? (
              <>
                <td className="py-2 pr-2 font-mono tabular-nums">${totalIncome.toLocaleString()}</td>
                <td className="py-2 pr-2 font-mono tabular-nums">${totalGrossRp!.toLocaleString()}</td>
                <td className="py-2 font-mono tabular-nums">${totalTaxRp!.toLocaleString()}</td>
              </>
            ) : (
              <>
                <td className="py-2 pr-2 font-mono tabular-nums">${totalIncome.toLocaleString()}</td>
                <td className="py-2 font-mono tabular-nums">${totalTax.toLocaleString()}</td>
              </>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
