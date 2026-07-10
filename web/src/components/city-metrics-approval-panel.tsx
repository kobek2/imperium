"use client";

import {
  APPROVAL_BLEND_WEIGHTS,
  buildApprovalBreakdown,
  buildApprovalTrendAlignment,
  buildMetricContributions,
  type ApprovalBreakdown,
} from "@/lib/city-metrics-coordination";
import type { CityMetricKey } from "@/lib/city-metrics-graph";
import { approvalTone } from "@/lib/city-metrics-presentation";
import type { CityMetricsSnapshot } from "@/lib/city-metrics-data";

function BlendRow({
  label,
  value,
  weight,
  detail,
}: {
  label: string;
  value: number;
  weight: number;
  detail?: string;
}) {
  const weighted = value * weight;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-[var(--psc-muted)]">
          {label} <span className="font-mono">×{(weight * 100).toFixed(0)}%</span>
        </span>
        <span className="font-mono tabular-nums text-[var(--psc-ink)]">
          {value.toFixed(0)} → +{weighted.toFixed(1)}
        </span>
      </div>
      {detail ? <p className="text-[10px] text-[var(--psc-muted)]">{detail}</p> : null}
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--psc-border)]">
        <div
          className="h-full rounded-full bg-[var(--psc-accent)]"
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

function ContributionRow({
  label,
  value,
  sharePct,
}: {
  label: string;
  value: number;
  sharePct: number;
}) {
  const tone = approvalTone(value);
  const barClass =
    tone === "good" ? "bg-green-600" : tone === "bad" ? "bg-red-600" : "bg-amber-600";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_2.5rem_2.5rem] items-center gap-2 text-xs">
      <span className="truncate text-[var(--psc-muted)]">{label}</span>
      <span className="text-right font-mono tabular-nums text-[var(--psc-ink)]">{value}</span>
      <div className="flex items-center gap-1">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--psc-border)]">
          <div className={`h-full ${barClass}`} style={{ width: `${Math.min(100, sharePct)}%` }} />
        </div>
      </div>
    </div>
  );
}

export function CityMetricsApprovalPanel({
  metrics,
  compact = false,
  onSuggestChartMetrics,
}: {
  metrics: CityMetricsSnapshot;
  compact?: boolean;
  onSuggestChartMetrics?: (keys: CityMetricKey[]) => void;
}) {
  const meta = metrics.presentationMeta;
  const breakdown: ApprovalBreakdown = buildApprovalBreakdown({
    metrics: metrics.state.metrics,
    mayorElectoralApproval: meta.mayorElectoralApproval,
    departmentFundingModifier: meta.departmentFundingModifier,
    cooperationBonus: meta.cooperationBonus,
  });
  const contributions = buildMetricContributions(metrics.state.metrics);
  const trend = buildApprovalTrendAlignment(metrics.history);
  const topDrivers = contributions.slice(0, 3).map((c) => c.key);

  return (
    <section className="space-y-4 rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)]">
            Approval coordination
          </h3>
          <p className="mt-0.5 text-[10px] text-[var(--psc-muted)]">{trend.summary}</p>
        </div>
        {!compact && onSuggestChartMetrics ? (
          <button
            type="button"
            onClick={() => onSuggestChartMetrics(topDrivers)}
            className="rounded border border-[var(--psc-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--psc-muted)]"
          >
            Chart top drivers
          </button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Blended approval ({breakdown.blended})
          </p>
          <BlendRow
            label="City metrics composite"
            value={breakdown.composite}
            weight={APPROVAL_BLEND_WEIGHTS.composite}
          />
          <BlendRow
            label="Electoral mandate"
            value={breakdown.electoral}
            weight={APPROVAL_BLEND_WEIGHTS.electoral}
            detail="Ward-weighted election result; decays over cycles."
          />
          <BlendRow
            label="Department funding slot"
            value={breakdown.departmentSlotValue}
            weight={APPROVAL_BLEND_WEIGHTS.department}
            detail={
              breakdown.departmentFundingModifier !== 0
                ? `Modifier ${breakdown.departmentFundingModifier > 0 ? "+" : ""}${breakdown.departmentFundingModifier} from dept. over/under fund.`
                : "Neutral — departments at or above statutory floors."
            }
          />
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Metric drivers (composite weights)
          </p>
          <div className="space-y-1.5">
            {contributions.map((c) => (
              <ContributionRow
                key={c.key}
                label={c.label}
                value={Math.round(c.value)}
                sharePct={c.shareOfCompositePct}
              />
            ))}
          </div>
        </div>
      </div>

      {!compact && trend.points.length >= 2 ? (
        <p className="text-[10px] text-[var(--psc-muted)]">
          Latest tick: approval {trend.points[trend.points.length - 1]?.approval.toFixed(0)} vs composite{" "}
          {trend.points[trend.points.length - 1]?.composite.toFixed(0)} (gap{" "}
          {trend.latestGap >= 0 ? "+" : ""}
          {trend.latestGap.toFixed(1)}). Overlay metrics on the chart to verify they move with approval.
        </p>
      ) : null}
    </section>
  );
}
