"use client";

import {
  CITY_METRIC_KEYS,
  CITY_METRIC_LABELS,
  type CityMetricKey,
} from "@/lib/city-metrics-graph";
import type { CityMetricHistoryPoint } from "@/lib/city-metrics-engine";
import type { EnrichedCityMetricHistoryPoint } from "@/lib/city-metrics-presentation";
import { computeApprovalRating } from "@/lib/city-metrics-presentation";

const LINE_COLORS: Record<CityMetricKey, string> = {
  education: "#1d4ed8",
  crime: "#047857",
  economy: "#b45309",
  public_health: "#be123c",
  housing: "#7c3aed",
  public_trust: "#0e7490",
  infrastructure: "#4f46e5",
  environment: "#15803d",
};

const APPROVAL_COLOR = "#9333ea";

function polyline(points: Array<{ x: number; y: number }>): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

function approvalValue(point: CityMetricHistoryPoint | EnrichedCityMetricHistoryPoint): number {
  if ("approvalRating" in point && point.approvalRating != null) return point.approvalRating;
  return computeApprovalRating(point.metrics);
}

export function CityMetricsChart({
  history,
  selectedMetrics,
  showApproval = false,
  height = 200,
}: {
  history: (CityMetricHistoryPoint | EnrichedCityMetricHistoryPoint)[];
  selectedMetrics?: CityMetricKey[];
  showApproval?: boolean;
  height?: number;
}) {
  const keys = selectedMetrics ?? CITY_METRIC_KEYS;
  const sorted = [...history].sort((a, b) => a.tick - b.tick);

  if (sorted.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] text-sm text-[var(--psc-muted)]"
        style={{ height }}
      >
        Metric history builds as council turns advance.
      </div>
    );
  }

  const width = 640;
  const pad = { top: 12, right: 12, bottom: 28, left: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const ticks = sorted.map((p) => p.tick);
  const minTick = Math.min(...ticks);
  const maxTick = Math.max(...ticks);

  const metricSeries = keys.map((key) => ({
    key,
    label: CITY_METRIC_LABELS[key],
    color: LINE_COLORS[key],
    strokeWidth: 2,
    points: sorted.map((p) => ({
      x: pad.left + ((p.tick - minTick) / Math.max(1, maxTick - minTick)) * innerW,
      y: pad.top + innerH - (p.metrics[key] / 100) * innerH,
      value: p.metrics[key],
      tick: p.tick,
    })),
  }));

  const approvalSeries = showApproval
    ? {
        key: "approval_rating" as const,
        label: "Approval",
        color: APPROVAL_COLOR,
        strokeWidth: 3,
        points: sorted.map((p) => {
          const value = approvalValue(p);
          return {
            x: pad.left + ((p.tick - minTick) / Math.max(1, maxTick - minTick)) * innerW,
            y: pad.top + innerH - (value / 100) * innerH,
            value,
            tick: p.tick,
          };
        }),
      }
    : null;

  const series = approvalSeries ? [approvalSeries, ...metricSeries] : metricSeries;
  const yTicks = [0, 25, 50, 75, 100];

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[320px]" role="img" aria-label="City metrics over time">
        {yTicks.map((v) => {
          const y = pad.top + innerH - (v / 100) * innerH;
          return (
            <g key={v}>
              <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="var(--psc-border)" strokeWidth={1} />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize={9} fill="var(--psc-muted)">
                {v}
              </text>
            </g>
          );
        })}
        {series.map((s) => (
          <path
            key={s.key}
            d={polyline(s.points)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.strokeWidth}
            strokeLinejoin="round"
          />
        ))}
        <text x={pad.left} y={height - 6} fontSize={9} fill="var(--psc-muted)">
          Tick {minTick}
        </text>
        <text x={width - pad.right} y={height - 6} fontSize={9} fill="var(--psc-muted)" textAnchor="end">
          Tick {maxTick}
        </text>
      </svg>
      <ul className="mt-2 flex flex-wrap gap-3 text-[10px]">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: s.color }} />
            <span className="text-[var(--psc-muted)]">{s.label}</span>
            <span className="font-mono font-semibold tabular-nums text-[var(--psc-ink)]">
              {s.points[s.points.length - 1]?.value ?? "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
