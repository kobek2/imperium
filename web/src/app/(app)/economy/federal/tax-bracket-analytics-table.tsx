import type { BracketBandStat } from "@/lib/fiscal-bracket-analytics";

export function TaxBracketAnalyticsTable({
  bands,
  totalIncome,
  totalTax,
  playerCountWithIncome,
}: {
  bands: BracketBandStat[];
  totalIncome: number;
  totalTax: number;
  playerCountWithIncome: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--psc-border)] text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
            <th className="py-2 pr-2">Band</th>
            <th className="py-2 pr-2">Ceiling</th>
            <th className="py-2 pr-2">Rate</th>
            <th className="py-2 pr-2">Players w/ income here</th>
            <th className="py-2 pr-2">Income in band</th>
            <th className="py-2">Revenue from band</th>
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
              <td className="py-2 pr-2 font-mono tabular-nums">${b.aggregateIncomeInBand.toLocaleString()}</td>
              <td className="py-2 font-mono tabular-nums text-emerald-800">${b.revenueFromBand.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--psc-border)] font-semibold text-[var(--psc-ink)]">
            <td className="py-2 pr-2" colSpan={3}>
              Totals ({playerCountWithIncome} players with positive inflows this FY)
            </td>
            <td className="py-2 pr-2">—</td>
            <td className="py-2 pr-2 font-mono tabular-nums">${totalIncome.toLocaleString()}</td>
            <td className="py-2 font-mono tabular-nums">${totalTax.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
