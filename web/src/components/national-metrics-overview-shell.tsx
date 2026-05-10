"use client";

import { useMemo, useState } from "react";
import { NavRouteButton } from "@/components/nav-route-button";
import {
  formatMetricValue,
  metricNumeric,
  NATIONAL_METRIC_FIELD_DEFS,
  type NationalMetricFieldDef,
} from "@/lib/national-metrics-overview-fields";
import type { NationalMetricsHistoryRow, NationalMetricsRow } from "@/lib/national-metrics-types";

type TabId = "overview" | "economy" | "education" | "society" | "crime" | "infrastructure";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "economy", label: "Economy" },
  { id: "education", label: "Education" },
  { id: "society", label: "Society" },
  { id: "crime", label: "Crime" },
  { id: "infrastructure", label: "Infrastructure" },
];

function MiniSparkline({
  values,
  width = 132,
  height = 44,
  positiveGood,
}: {
  values: number[];
  width?: number;
  height?: number;
  /** When true, higher values use emerald stroke; when false, lower is better (e.g. unemployment). */
  positiveGood: boolean;
}) {
  const w = width;
  const h = height;
  if (values.length < 2) {
    return <div className="h-[44px] w-[132px] rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]" />;
  }
  const finite = values.filter((x) => Number.isFinite(x));
  if (finite.length < 2) {
    return <div className="h-[44px] w-[132px] rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]" />;
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const pad = 3;
  const span = max - min || 1;
  const pts = finite
    .map((v, i) => {
      const x = pad + (i / (finite.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((v - min) / span) * (h - 2 * pad);
      return `${x},${y}`;
    })
    .join(" ");
  const last = finite[finite.length - 1]!;
  const first = finite[0]!;
  const trendUp = last > first;
  const stroke =
    last === first
      ? "var(--psc-muted)"
      : positiveGood
        ? trendUp
          ? "rgb(6 95 70)"
          : "rgb(190 24 93)"
        : trendUp
          ? "rgb(190 24 93)"
          : "rgb(6 95 70)";

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 text-[var(--psc-muted)]">
      <polyline fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

function deltaLabel(cur: number | null, prev: number | null, format: NationalMetricFieldDef["format"]): string | null {
  if (cur == null || prev == null || Number.isNaN(cur) || Number.isNaN(prev)) return null;
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return "No change";
  if (format === "money0" || format === "int0") {
    const sign = d > 0 ? "+" : "";
    return `${sign}${d.toLocaleString(undefined, { maximumFractionDigits: format === "money0" ? 0 : 0 })}`;
  }
  return `${d > 0 ? "+" : ""}${d.toFixed(format === "years2" ? 2 : 1)}${format.startsWith("pct") || format === "score1" ? " pts" : ""}`;
}

export function NationalMetricsOverviewShell({
  fyLabel,
  activeYearIndex,
  current,
  prior,
  history,
  budgetTotalAllocated,
  budgetLines,
  budgetStatus,
  showFederalBudgetLink,
}: {
  fyLabel: string;
  activeYearIndex: number;
  current: NationalMetricsRow | null;
  prior: NationalMetricsHistoryRow | null;
  history: NationalMetricsHistoryRow[];
  budgetTotalAllocated: number | null;
  budgetLines: Array<{ key: string; label: string; allocated: number }>;
  budgetStatus: string;
  showFederalBudgetLink: boolean;
}) {
  const [tab, setTab] = useState<TabId>("overview");

  const historyAsc = useMemo(
    () => [...history].sort((a, b) => a.year_index - b.year_index),
    [history],
  );

  const seriesFor = (field: keyof NationalMetricsRow): number[] =>
    historyAsc.map((row) => metricNumeric(row, field)).filter((n): n is number => n != null);

  const movers = useMemo(() => {
    if (!current || !prior) return [];
    const scored = NATIONAL_METRIC_FIELD_DEFS.map((def) => {
      const c = metricNumeric(current, def.field);
      const p = metricNumeric(prior, def.field);
      if (c == null || p == null) return null;
      const delta = c - p;
      const invert =
        def.field === "unemployment_rate" ||
        def.field === "poverty_percentage" ||
        def.field === "education_dropout_rate" ||
        def.field === "crime_total" ||
        def.field === "crime_prisoners" ||
        def.field === "homelessness" ||
        def.field === "infrastructure_road_congestion" ||
        def.field === "us_debt";
      const good = invert ? delta < 0 : delta > 0;
      return { def, delta, abs: Math.abs(delta), good, cur: c, prev: p };
    }).filter(Boolean) as Array<{
      def: NationalMetricFieldDef;
      delta: number;
      abs: number;
      good: boolean;
      cur: number;
      prev: number;
    }>;
    return scored
      .filter((s) => s.abs > 1e-6)
      .sort((a, b) => b.abs - a.abs)
      .slice(0, 5);
  }, [current, prior]);

  const overviewSparkFields: (keyof NationalMetricsRow)[] = [
    "government_approval",
    "unemployment_rate",
    "poverty_percentage",
    "crime_total",
  ];

  const fieldsForTab = (t: TabId) =>
    t === "overview"
      ? NATIONAL_METRIC_FIELD_DEFS
      : NATIONAL_METRIC_FIELD_DEFS.filter((d) => d.category === t);

  return (
    <section className="space-y-6 rounded border border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-seal)_10%,var(--psc-panel))] p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--psc-border)] pb-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Nation</p>
          <h2 className="text-xl font-semibold text-[var(--psc-ink)]">National metrics</h2>
          <p className="mt-1 text-sm text-[var(--psc-muted)]">
            Active fiscal year <span className="font-semibold text-[var(--psc-ink)]">{fyLabel}</span> (FY index{" "}
            {activeYearIndex}). Same figures that feed year-end inbox reports; compare to the last closed year when
            available.
          </p>
        </div>
        {showFederalBudgetLink ? (
          <NavRouteButton href="/economy/federal" className="shrink-0">
            Federal budget
          </NavRouteButton>
        ) : null}
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-[var(--psc-border)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-t-md border border-b-0 px-3 py-2 text-sm font-semibold transition-colors ${
              tab === t.id
                ? "border-[var(--psc-border)] bg-[var(--psc-panel)] text-[var(--psc-ink)]"
                : "border-transparent bg-transparent text-[var(--psc-muted)] hover:text-[var(--psc-ink)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="space-y-6 rounded-b-md rounded-tr-md border border-t-0 border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          {!current ? (
            <p className="text-sm text-[var(--psc-muted)]">National metrics are not configured for this fiscal year yet.</p>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,1.1fr)]">
                <div className="space-y-3 rounded-lg border border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-ink)_4%,var(--psc-canvas))] p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    Federal appropriations (this workbook)
                  </h3>
                  <p className="font-mono text-2xl font-semibold tabular-nums text-[var(--psc-ink)]">
                    {budgetTotalAllocated != null && budgetTotalAllocated > 0
                      ? `$${budgetTotalAllocated.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                      : "—"}
                  </p>
                  <p className="text-xs text-[var(--psc-muted)]">
                    Budget status: <span className="font-mono font-semibold text-[var(--psc-ink)]">{budgetStatus || "—"}</span>
                    . Totals sum enacted line items on the active federal row (same basis as the economy page).
                  </p>
                  {budgetLines.length > 0 ? (
                    <div className="mt-2 max-h-40 overflow-y-auto border-t border-[var(--psc-border)] pt-2">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
                            <th className="py-1 pr-2">Program</th>
                            <th className="py-1 text-right">Allocated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {budgetLines.map((row) => (
                            <tr key={row.key} className="border-b border-[var(--psc-border)]/50 last:border-0">
                              <td className="py-1 pr-2 text-[var(--psc-ink)]">{row.label}</td>
                              <td className="py-1 text-right font-mono tabular-nums text-[var(--psc-ink)]">
                                ${row.allocated.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    vs last closed fiscal year
                    {prior ? (
                      <span className="ml-2 font-normal normal-case text-[var(--psc-muted)]">({prior.year_label})</span>
                    ) : null}
                  </h3>
                  {!prior ? (
                    <p className="text-sm text-[var(--psc-muted)]">
                      After the first year closes, year-over-year chips and the table below will compare this active year to
                      the most recent closed year.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {movers.map(({ def, good }) => {
                        const lbl = deltaLabel(
                          metricNumeric(current, def.field),
                          metricNumeric(prior, def.field),
                          def.format,
                        );
                        if (!lbl) return null;
                        return (
                          <div
                            key={def.field}
                            className={`rounded-full border px-3 py-2 text-sm font-semibold shadow-sm ${
                              good
                                ? "border-emerald-700/40 bg-emerald-50 text-emerald-950"
                                : "border-rose-700/40 bg-rose-50 text-rose-950"
                            }`}
                          >
                            <span className="block text-[10px] font-medium uppercase tracking-wide opacity-80">
                              {def.label}
                            </span>
                            <span className="font-mono tabular-nums">{lbl}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Recent trajectory</h3>
                <p className="mt-1 text-xs text-[var(--psc-muted)]">
                  Sparklines use stored national metrics by fiscal year (oldest to newest left to right).
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {overviewSparkFields.map((field) => {
                    const def = NATIONAL_METRIC_FIELD_DEFS.find((d) => d.field === field)!;
                    const vals = seriesFor(field);
                    const positiveGood =
                      field !== "unemployment_rate" &&
                      field !== "poverty_percentage" &&
                      field !== "crime_total";
                    return (
                      <div
                        key={field}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2"
                      >
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                            {def.label}
                          </p>
                          <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--psc-ink)]">
                            {formatMetricValue(metricNumeric(current, field), def.format)}
                          </p>
                        </div>
                        <MiniSparkline values={vals} positiveGood={positiveGood} />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                  Full comparison (active vs last closed)
                </h3>
                <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)]">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--psc-border)] bg-[var(--psc-ink)] text-white">
                        <th className="px-3 py-2">Indicator</th>
                        <th className="px-3 py-2 text-right">{fyLabel}</th>
                        <th className="px-3 py-2 text-right">{prior?.year_label ?? "Prior"}</th>
                        <th className="px-3 py-2 text-right">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {NATIONAL_METRIC_FIELD_DEFS.map((def) => {
                        const c = metricNumeric(current, def.field);
                        const p = prior ? metricNumeric(prior, def.field) : null;
                        const dl = prior && c != null && p != null ? deltaLabel(c, p, def.format) : "—";
                        const invert =
                          def.field === "unemployment_rate" ||
                          def.field === "poverty_percentage" ||
                          def.field === "education_dropout_rate" ||
                          def.field === "crime_total" ||
                          def.field === "crime_prisoners" ||
                          def.field === "homelessness" ||
                          def.field === "infrastructure_road_congestion" ||
                          def.field === "us_debt";
                        const good =
                          prior && c != null && p != null
                            ? invert
                              ? c - p < 0
                              : c - p > 0
                            : null;
                        return (
                          <tr key={def.field} className="border-b border-[var(--psc-border)]/60 last:border-0">
                            <td className="px-3 py-2 font-medium text-[var(--psc-ink)]">{def.label}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--psc-ink)]">
                              {formatMetricValue(c, def.format)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--psc-muted)]">
                              {prior ? formatMetricValue(p, def.format) : "—"}
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-mono text-sm font-semibold tabular-nums ${
                                good === true
                                  ? "text-emerald-800"
                                  : good === false
                                    ? "text-rose-800"
                                    : "text-[var(--psc-muted)]"
                              }`}
                            >
                              {dl}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {history.length > 1 ? (
            <div className="border-t border-[var(--psc-border)] pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Fiscal year trail</h3>
              <p className="mt-1 text-xs text-[var(--psc-muted)]">Snapshot of a few headline indicators per year on file.</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-ink)_8%,var(--psc-canvas))] text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
                      <th className="px-2 py-2">FY</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2 text-right">Approval</th>
                      <th className="px-2 py-2 text-right">Unemployment</th>
                      <th className="px-2 py-2 text-right">Poverty</th>
                      <th className="px-2 py-2 text-right">Crime (sim)</th>
                      <th className="px-2 py-2 text-right">Life exp.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...history].sort((a, b) => b.year_index - a.year_index).map((row) => (
                      <tr key={row.fiscal_year_id} className="border-b border-[var(--psc-border)]/50">
                        <td className="px-2 py-2 font-medium text-[var(--psc-ink)]">{row.year_label}</td>
                        <td className="px-2 py-2 text-[var(--psc-muted)]">{row.fiscal_status}</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">
                          {row.government_approval == null ? "—" : `${Number(row.government_approval).toFixed(1)}%`}
                        </td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">
                          {row.unemployment_rate == null ? "—" : `${Number(row.unemployment_rate).toFixed(1)}%`}
                        </td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">
                          {row.poverty_percentage == null ? "—" : `${Number(row.poverty_percentage).toFixed(1)}%`}
                        </td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">
                          {row.crime_total == null ? "—" : Number(row.crime_total).toLocaleString()}
                        </td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">
                          {row.life_expectancy == null ? "—" : Number(row.life_expectancy).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4 rounded-b-md rounded-tr-md border border-t-0 border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          {!current ? (
            <p className="text-sm text-[var(--psc-muted)]">No metrics for this view yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fieldsForTab(tab).map((def) => {
                const vals = seriesFor(def.field);
                const positiveGood =
                  def.field !== "unemployment_rate" &&
                  def.field !== "poverty_percentage" &&
                  def.field !== "education_dropout_rate" &&
                  def.field !== "crime_total" &&
                  def.field !== "crime_prisoners" &&
                  def.field !== "homelessness" &&
                  def.field !== "infrastructure_road_congestion" &&
                  def.field !== "us_debt";
                return (
                  <div
                    key={def.field}
                    className="flex flex-col gap-2 rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                          {def.label}
                        </p>
                        <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-[var(--psc-ink)]">
                          {formatMetricValue(metricNumeric(current, def.field), def.format)}
                        </p>
                      </div>
                      <MiniSparkline values={vals} positiveGood={positiveGood} />
                    </div>
                    {prior ? (
                      <p className="text-xs text-[var(--psc-muted)]">
                        Was {formatMetricValue(metricNumeric(prior, def.field), def.format)} in {prior.year_label}
                        {metricNumeric(current, def.field) != null && metricNumeric(prior, def.field) != null ? (
                          <span
                            className={`ml-1 font-semibold ${
                              (positiveGood
                                ? metricNumeric(current, def.field)! > metricNumeric(prior, def.field)!
                                : metricNumeric(current, def.field)! < metricNumeric(prior, def.field)!)
                                ? "text-emerald-800"
                                : metricNumeric(current, def.field)! === metricNumeric(prior, def.field)!
                                  ? "text-[var(--psc-muted)]"
                                  : "text-rose-800"
                            }`}
                          >
                            (
                            {deltaLabel(metricNumeric(current, def.field), metricNumeric(prior, def.field), def.format) ??
                              "—"}
                            )
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
