"use client";

import { useMemo } from "react";
import type { CityFiscalDepartmentKey } from "@/lib/city-fiscal-data";
import {
  budgetToPolicyVariableDeltasPlayerScale,
  previewBlendedApprovalChange,
} from "@/lib/city-metrics-coordination";
import { previewPolicyEffects } from "@/lib/city-metrics-data";
import type { CityMetricsSnapshot } from "@/lib/city-metrics-data";
import { CITY_METRIC_LABELS, type CityMetricKey } from "@/lib/city-metrics-graph";
import { previewPolicyNarratives } from "@/lib/city-metrics-presentation";
import { economicFiscalContextFromSnapshot } from "@/lib/city-economic-indicator";

export function BudgetCoordinationPreview({
  metrics,
  fiscal,
  departments,
  deficitMillions,
  annualGdpUsd,
  totalRevenueMillions,
}: {
  metrics: CityMetricsSnapshot | null;
  fiscal: { population: number; businessTaxRevenueMillions: number; officeSalaryPoolMillions: number };
  departments: { departmentKey: CityFiscalDepartmentKey; amountMillions: number }[];
  deficitMillions: number;
  annualGdpUsd: number;
  totalRevenueMillions: number;
}) {
  const preview = useMemo(() => {
    if (!metrics) return null;

    const policyDeltas = budgetToPolicyVariableDeltasPlayerScale(
      departments,
      annualGdpUsd,
      deficitMillions,
      totalRevenueMillions,
    );
    const fiscalCtx = economicFiscalContextFromSnapshot({
      population: fiscal.population,
      businessTaxRevenueMillions: fiscal.businessTaxRevenueMillions,
      officeSalaryPoolMillions: fiscal.officeSalaryPoolMillions,
    });
    const { state: afterState, history } = previewPolicyEffects(
      metrics.state,
      policyDeltas,
      3,
      fiscalCtx,
    );
    const lastPoint = history[history.length - 1];
    if (!lastPoint) return null;

    const approvalChange = previewBlendedApprovalChange({
      beforeState: metrics.state,
      afterMetrics: afterState.metrics,
      mayorElectoralApproval: metrics.presentationMeta.mayorElectoralApproval,
      departmentFundingModifier: metrics.presentationMeta.departmentFundingModifier,
    });

    const metricDeltas: Partial<Record<CityMetricKey, number>> = {};
    for (const key of Object.keys(lastPoint.metrics) as CityMetricKey[]) {
      const d = lastPoint.metrics[key] - metrics.state.metrics[key];
      if (Math.abs(d) >= 0.5) metricDeltas[key] = d;
    }

    const narratives = previewPolicyNarratives({
      before: metrics.state.metrics,
      after: afterState.metrics,
      policyName: "proposed budget",
    });

    return { approvalChange, metricDeltas, narratives };
  }, [metrics, fiscal, departments, deficitMillions, annualGdpUsd, totalRevenueMillions]);

  if (!metrics) {
    return (
      <p className="text-sm text-[var(--psc-muted)]">
        Metrics engine loading — approval preview will appear after the first sim tick.
      </p>
    );
  }

  if (!preview) {
    return (
      <p className="text-sm text-[var(--psc-muted)]">
        Enacting at baseline spending levels — minimal metric shift beyond treasury update.
      </p>
    );
  }

  const { approvalChange, metricDeltas, narratives } = preview;
  const deltaEntries = Object.entries(metricDeltas) as [CityMetricKey, number][];

  return (
    <div className="space-y-3 text-sm">
      <p className="font-medium text-[var(--psc-ink)]">
        Projected approval: {approvalChange.before.toFixed(0)} →{" "}
        <span className={approvalChange.delta >= 0 ? "text-green-800" : "text-red-800"}>
          {approvalChange.after.toFixed(0)}
        </span>
        {approvalChange.delta !== 0 ? (
          <span className="text-[var(--psc-muted)]">
            {" "}
            ({approvalChange.delta >= 0 ? "+" : ""}
            {approvalChange.delta.toFixed(1)})
          </span>
        ) : null}
      </p>

      {deltaEntries.length > 0 ? (
        <ul className="space-y-1 text-xs text-[var(--psc-muted)]">
          {deltaEntries.map(([key, delta]) => (
            <li key={key}>
              {CITY_METRIC_LABELS[key]}{" "}
              <span className={delta >= 0 ? "text-green-800" : "text-red-800"}>
                {delta >= 0 ? "+" : ""}
                {delta.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-[var(--psc-muted)]">Underlying metrics hold steady over the preview window.</p>
      )}

      {narratives.length > 0 ? (
        <ul className="space-y-1 text-xs italic text-[var(--psc-muted)]">
          {narratives.map((line) => (
            <li key={line.slice(0, 40)}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
