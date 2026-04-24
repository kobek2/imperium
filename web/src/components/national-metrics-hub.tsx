import type { ReactNode } from "react";
import { NationalMetricsDisplay } from "@/components/national-metrics-display";
import type { NationalMetricsHistoryRow, NationalMetricsRow } from "@/lib/national-metrics-types";

export function NationalMetricsHub({
  current,
  history,
  title = "National metrics",
  kicker = "Nation",
  description,
  headerAside,
}: {
  current: NationalMetricsRow | null;
  history: NationalMetricsHistoryRow[];
  title?: string;
  kicker?: string;
  description: ReactNode;
  headerAside?: ReactNode;
}) {
  return (
    <section className="space-y-6 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">{kicker}</p>
          <h2 className="text-xl font-semibold text-[var(--psc-ink)]">{title}</h2>
          <div className="mt-2 max-w-3xl text-sm text-[var(--psc-muted)]">{description}</div>
        </div>
        {headerAside ? <div className="flex flex-wrap gap-2">{headerAside}</div> : null}
      </div>

      <NationalMetricsDisplay m={current} />

      {history.length > 1 ? (
        <div className="border-t border-[var(--psc-border)] pt-6">
          <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Recent fiscal years (trend)</h3>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Rows keyed to each fiscal year. Federal income tax uses marginal brackets on employment income in that year (role
            salary + PAC hourly collects), not gifts or transfers.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--psc-border)] text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
                  <th className="py-2 pr-2">FY</th>
                  <th className="py-2 pr-2">Approval</th>
                  <th className="py-2 pr-2">Unemployment</th>
                  <th className="py-2 pr-2">Debt (sim)</th>
                  <th className="py-2">Life exp.</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.fiscal_year_id} className="border-b border-[var(--psc-border)]/60">
                    <td className="py-2 pr-2 font-medium text-[var(--psc-ink)]">{row.year_label}</td>
                    <td className="py-2 pr-2 font-mono tabular-nums">
                      {row.government_approval == null ? "—" : `${Number(row.government_approval).toFixed(1)}%`}
                    </td>
                    <td className="py-2 pr-2 font-mono tabular-nums">
                      {row.unemployment_rate == null ? "—" : `${Number(row.unemployment_rate).toFixed(1)}%`}
                    </td>
                    <td className="py-2 pr-2 font-mono tabular-nums">
                      {row.us_debt == null ? "—" : `$${Number(row.us_debt).toLocaleString()}`}
                    </td>
                    <td className="py-2 font-mono tabular-nums">
                      {row.life_expectancy == null ? "—" : Number(row.life_expectancy).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
