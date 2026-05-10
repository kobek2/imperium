import { TaxBracketAnalyticsTable } from "./tax-bracket-analytics-table";
import type { BracketBandStat } from "@/lib/fiscal-bracket-analytics";
import { lineItemDefaultLabel } from "@/lib/line-item-budget-effects";

export type FederalPriorYearSnapshot = {
  label: string;
  yearIndex: number;
  startedAt: string;
  closedAt: string | null;
  gdp_opening_total: number | null;
  gdp_closing_total: number | null;
  bracketAnalytics: {
    bands: BracketBandStat[];
    totalIncome: number;
    totalTax: number;
    playerCountWithIncome: number;
  };
  priorLineItems: Array<{ key: string; minimum: number; allocated: number }>;
};

function money(n: number | null): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function FederalPriorYearSidebar({ snapshot }: { snapshot: FederalPriorYearSnapshot }) {
  const { bracketAnalytics: a } = snapshot;
  const totalPriorAlloc = snapshot.priorLineItems.reduce((s, r) => s + (Number(r.allocated) || 0), 0);

  return (
    <aside className="space-y-6 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Reference</p>
        <h2 className="mt-1 text-lg font-semibold text-[var(--psc-ink)]">Prior fiscal year</h2>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Year</dt>
          <dd className="mt-1 font-semibold text-[var(--psc-ink)]">{snapshot.label}</dd>
        </div>
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Closed</dt>
          <dd className="mt-1 text-[var(--psc-ink)]">
            {snapshot.closedAt ? new Date(snapshot.closedAt).toLocaleString() : "—"}
          </dd>
        </div>
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Government spending (final)</dt>
          <dd className="mt-1 font-mono text-xs tabular-nums text-[var(--psc-ink)]">{money(totalPriorAlloc)}</dd>
        </div>
      </dl>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Bracket impact (that year)</h3>
        {a.bands.length > 0 ? (
          <TaxBracketAnalyticsTable
            bands={a.bands}
            totalIncome={a.totalIncome}
            totalTax={a.totalTax}
            playerCountWithIncome={a.playerCountWithIncome}
          />
        ) : (
          <p className="text-xs text-[var(--psc-muted)]">No bracket rows on file for that year.</p>
        )}
      </div>

      {snapshot.priorLineItems.length > 0 ? (
        <div className="space-y-2 border-t border-[var(--psc-border)] pt-4">
          <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Line items (closed year)</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--psc-border)] text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
                  <th className="py-1.5 pr-2">Program</th>
                  <th className="py-1.5 pr-2">Min</th>
                  <th className="py-1.5">Alloc</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.priorLineItems.map((row) => (
                  <tr key={row.key} className="border-b border-[var(--psc-border)]/50">
                    <td className="py-1.5 pr-2 text-[var(--psc-ink)]">{lineItemDefaultLabel(row.key)}</td>
                    <td className="py-1.5 pr-2 font-mono tabular-nums">{money(row.minimum)}</td>
                    <td className="py-1.5 font-mono tabular-nums">{money(row.allocated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
