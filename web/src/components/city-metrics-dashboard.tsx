"use client";

import { useMemo, useState } from "react";
import { CityMetricsChart } from "@/components/city-metrics-chart";
import { recommendedChartMetrics } from "@/lib/city-metrics-coordination";
import { formatFiscalMillions } from "@/lib/city-fiscal-data";
import { formatCitySimWeek } from "@/lib/city-sim-week";
import type { CityFiscalSnapshot } from "@/lib/city-fiscal-data";
import {
  CITY_METRIC_KEYS,
  CITY_METRIC_LABELS,
  CITY_POLICY_VARIABLE_KEYS,
  CITY_POLICY_VARIABLE_LABELS,
  type CityMetricKey,
} from "@/lib/city-metrics-graph";
import { buildMetricTimeSeries } from "@/lib/city-metrics-engine";
import type { CityMetricsSnapshot } from "@/lib/city-metrics-data";

function metricTone(value: number): "good" | "mid" | "bad" {
  if (value >= 60) return "good";
  if (value >= 40) return "mid";
  return "bad";
}

function MetricTile({ label, value }: { label: string; value: number }) {
  const tone = metricTone(value);
  const toneClass =
    tone === "good"
      ? "border-green-300/60 bg-green-50/50 dark:bg-green-950/20"
      : tone === "bad"
        ? "border-red-300/60 bg-red-50/50 dark:bg-red-950/20"
        : "border-[var(--psc-border)] bg-[var(--psc-canvas)]";

  return (
    <div className={`rounded border p-3 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--psc-ink)]">{value}</p>
    </div>
  );
}

export function CityMetricsDashboard({
  metrics,
  fiscal,
  isAdmin,
}: {
  metrics: CityMetricsSnapshot;
  fiscal: CityFiscalSnapshot;
  isAdmin?: boolean;
}) {
  const [snapshot, setSnapshot] = useState(metrics);
  const [chartMetrics, setChartMetrics] = useState<CityMetricKey[]>([]);
  const [showMetricDrilldown, setShowMetricDrilldown] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const timeSeries = useMemo(() => buildMetricTimeSeries(snapshot.history), [snapshot.history]);
  const queueDepth = snapshot.state.effectQueue.length;

  const defaultDrivers = useMemo(
    () => recommendedChartMetrics(snapshot.state.metrics, 3),
    [snapshot.state.metrics],
  );

  const toggleChartMetric = (key: CityMetricKey) => {
    setChartMetrics((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key].slice(0, 4),
    );
  };

  const exportJson = () => {
    const payload = {
      cityCode: snapshot.state.cityCode,
      simTick: snapshot.state.tick,
      fiscalYear: snapshot.fiscalYear,
      currentMetrics: snapshot.state.metrics,
      policyVariables: snapshot.state.variables,
      timeSeries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `city-metrics-tick-${snapshot.state.tick}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--psc-ink)]">
            City pulse · {formatCitySimWeek(snapshot)} · FY{fiscal.fiscalYear}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
            Metrics propagate one week per staff advance. Underlying shifts surface as briefings when notable.
          </p>
        </div>
        <p className="text-xs text-[var(--psc-muted)]">
          Treasury {formatFiscalMillions(fiscal.treasuryBalance)} · {queueDepth} queued effect
          {queueDepth === 1 ? "" : "s"}
        </p>
      </div>

      <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Metrics history
          </h3>
          <button
            type="button"
            onClick={() => setShowMetricDrilldown((v) => !v)}
            className="rounded border border-[var(--psc-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--psc-muted)]"
          >
            {showMetricDrilldown ? "Hide" : "Overlay"} backend metrics
          </button>
        </div>
        {showMetricDrilldown ? (
          <div className="flex flex-wrap gap-1">
            {CITY_METRIC_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleChartMetric(key)}
                className={
                  chartMetrics.includes(key)
                    ? "rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-2 py-0.5 text-[10px] font-semibold text-white"
                    : "rounded border border-[var(--psc-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--psc-muted)]"
                }
              >
                {CITY_METRIC_LABELS[key]}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-[var(--psc-muted)]">
            Suggested overlays: {defaultDrivers.map((k) => CITY_METRIC_LABELS[k]).join(", ")}
          </p>
        )}
        <CityMetricsChart
          history={snapshot.history}
          selectedMetrics={showMetricDrilldown ? chartMetrics : defaultDrivers}
        />
      </div>

      <details className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3 text-sm">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          Backend metrics (drill-down)
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {CITY_METRIC_KEYS.map((key) => (
            <MetricTile key={key} label={CITY_METRIC_LABELS[key]} value={snapshot.state.metrics[key]} />
          ))}
        </div>
      </details>

      <details className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3 text-sm">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          Policy variables (immediate layer)
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {CITY_POLICY_VARIABLE_KEYS.map((key) => (
            <div key={key} className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-2 py-1.5">
              <p className="text-[10px] text-[var(--psc-muted)]">{CITY_POLICY_VARIABLE_LABELS[key]}</p>
              <p className="font-mono text-sm font-semibold tabular-nums">{snapshot.state.variables[key]}</p>
            </div>
          ))}
        </div>
      </details>

      {snapshot.state.recentShocks.length > 0 ? (
        <div className="rounded border border-amber-300/50 bg-amber-50/40 p-3 dark:bg-amber-950/20">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            External shocks
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {snapshot.state.recentShocks.slice(0, 4).map((s) => (
              <li key={`${s.shockId}-${s.tick}`}>
                <span className="font-medium text-[var(--psc-ink)]">Tick {s.tick}: {s.title}</span>
                <span className="text-[var(--psc-muted)]"> — {s.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {fiscal.recentEffects.length > 0 ? (
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Recent policy enactments
          </p>
          <ul className="mt-2 space-y-2 text-xs">
            {fiscal.recentEffects.slice(0, 5).map((e) => (
              <li key={e.id} className="border-b border-[var(--psc-border)]/40 pb-2 last:border-0 last:pb-0">
                <p className="font-medium text-[var(--psc-ink)]">{e.title}</p>
                <p className="text-[var(--psc-muted)]">{e.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setExportOpen((v) => !v)}
          className="rounded border border-[var(--psc-border)] px-3 py-1.5 text-xs font-semibold text-[var(--psc-ink)]"
        >
          {exportOpen ? "Hide" : "Show"} JSON export
        </button>
        {isAdmin ? (
          <p className="self-center text-xs text-[var(--psc-muted)]">
            Advance the sim week from Admin → Elections.
          </p>
        ) : null}
      </div>

      {exportOpen ? (
        <pre className="max-h-64 overflow-auto rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3 text-[10px]">
          {JSON.stringify({ simTick: snapshot.state.tick, timeSeries }, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}
