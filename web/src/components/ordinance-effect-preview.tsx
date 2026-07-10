"use client";

import { useMemo } from "react";
import {
  ordinanceToPolicyVariableDeltas,
  formatPolicyVariableDeltas,
} from "@/lib/city-metrics-policy-bridge";
import { previewPolicyEffects } from "@/lib/city-metrics-data";
import { createInitialEngineState } from "@/lib/city-metrics-engine";
import { previewPolicyNarratives } from "@/lib/city-metrics-presentation";
import { ordinanceIssueByKey } from "@/lib/city-ordinance-templates";
import { issueUsesParametricScoring } from "@/lib/city-ordinance-param-score";
import type { OrdinanceStanceParams } from "@/lib/city-ordinance-param-score";

export function OrdinanceEffectPreview({
  category,
  issueKey,
  stanceKey,
  stanceParams,
  policyName,
  compact,
}: {
  category: string;
  issueKey: string;
  stanceKey?: string | null;
  stanceParams?: OrdinanceStanceParams | null;
  policyName?: string;
  compact?: boolean;
}) {
  const deltas = useMemo(
    () =>
      issueUsesParametricScoring(issueKey) && stanceParams
        ? ordinanceToPolicyVariableDeltas(category, issueKey, null, stanceParams)
        : ordinanceToPolicyVariableDeltas(category, issueKey, stanceKey ?? ""),
    [category, issueKey, stanceKey, stanceParams],
  );

  const variableLines = formatPolicyVariableDeltas(deltas);

  const narrativeLines = useMemo(() => {
    if (!Object.keys(deltas).length) return [];
    const label =
      policyName ??
      ordinanceIssueByKey(category, issueKey)?.issue.title ??
      issueKey.replaceAll("_", " ");
    const base = createInitialEngineState().metrics;
    const { state } = previewPolicyEffects(createInitialEngineState(), deltas, 6);
    return previewPolicyNarratives({
      before: base,
      after: state.metrics,
      policyName: label,
    });
  }, [category, deltas, issueKey, policyName]);

  if (variableLines.length === 0) {
    return (
      <p className={`text-[var(--psc-muted)] ${compact ? "text-xs" : "text-sm"}`}>
        Minimal policy-variable shift; downstream metrics may drift slowly.
      </p>
    );
  }

  return (
    <div
      className={`rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] ${
        compact ? "p-2.5" : "p-3"
      }`}
    >
      <p className={`font-semibold text-[var(--psc-ink)] ${compact ? "text-xs" : "text-sm"}`}>
        If enacted, policy variables shift immediately:
      </p>
      <ul className={`mt-2 list-inside list-disc text-[var(--psc-muted)] ${compact ? "text-xs" : "text-sm"}`}>
        {variableLines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {narrativeLines.length > 0 ? (
        <div className={`mt-2 space-y-1 text-[var(--psc-muted)] ${compact ? "text-[10px]" : "text-xs"}`}>
          <p className="font-medium text-[var(--psc-ink)]">Expected headlines (modeled):</p>
          <ul className="list-inside list-disc">
            {narrativeLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
