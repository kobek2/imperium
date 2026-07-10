"use client";

import { useMemo } from "react";
import { getParametricBillDefinition } from "@/lib/city-ordinance-param-registry";
import { projectLocalSalesTaxRevenueUsd, SALES_TAX_ISSUE_KEY } from "@/lib/parametric-ordinance-bills";
import {
  ordinalStepIndex,
  paramRuleSatisfied,
  type OrdinanceBillParamSchema,
  type OrdinanceOrdinalStep,
  type OrdinanceParamDefinition,
} from "@/lib/city-ordinance-param-schema";

type Props = {
  issueKey: string;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
};

function ordinalStepsByKey(schema: OrdinanceBillParamSchema): Record<string, OrdinanceOrdinalStep[]> {
  const map: Record<string, OrdinanceOrdinalStep[]> = {};
  if (!schema) return map;
  for (const param of schema.parameters) {
    if (param.ordinalSteps) map[param.key] = param.ordinalSteps;
  }
  return map;
}

function paramVisible(
  param: OrdinanceParamDefinition,
  clamped: Record<string, unknown>,
  stepsByKey: Record<string, OrdinanceOrdinalStep[]>,
): boolean {
  return paramRuleSatisfied(clamped, param.visibleWhen, ordinalStepIndex, stepsByKey);
}

function formatContinuousValue(param: OrdinanceParamDefinition, value: number): string {
  const suffix = param.suffix ?? "";
  if (Math.abs(value) < 0.05 && suffix === "%") return "0%";
  const rounded = param.step != null && param.step >= 1 ? value.toFixed(0) : value.toFixed(1);
  if (suffix === "%" && value > 0) return `+${rounded}${suffix}`;
  return `${rounded}${suffix}`;
}

export function ParametricOrdinanceParamsForm({ issueKey, params, onChange }: Props) {
  const bill = getParametricBillDefinition(issueKey);
  const clamped = useMemo(
    () => (bill ? bill.clamp(params) : params),
    [bill, params],
  );
  const scores = useMemo(
    () => (bill ? bill.score(clamped) : null),
    [bill, clamped],
  );
  const stepsByKey = useMemo(
    () => (bill ? ordinalStepsByKey(bill.schema) : {}),
    [bill],
  );

  if (!bill) {
    return (
      <p className="text-sm text-[var(--psc-muted)]">Parameter form not available for this bill.</p>
    );
  }

  const definition = bill;

  function patch(next: Partial<Record<string, unknown>>) {
    onChange(definition.clamp({ ...clamped, ...next }));
  }

  return (
    <fieldset className="space-y-4">
      <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
        Policy parameters
      </legend>

      {bill.schema.parameters.map((param) => {
        if (!paramVisible(param, clamped, stepsByKey)) return null;

        if (param.kind === "ordinal" && param.ordinalSteps) {
          return (
            <div key={param.key} className="space-y-2">
              <p className="text-sm font-medium text-[var(--psc-ink)]">{param.label}</p>
              <div
                className={`grid gap-1 ${param.ordinalSteps.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1 sm:grid-cols-3"}`}
              >
                {param.ordinalSteps.map((step) => (
                  <button
                    key={step.value}
                    type="button"
                    onClick={() => patch({ [param.key]: step.value })}
                    className={
                      clamped[param.key] === step.value
                        ? "rounded border border-[var(--psc-accent)] bg-white px-2 py-2 text-xs font-semibold text-[var(--psc-accent)] ring-2 ring-[var(--psc-accent)]/30"
                        : "rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2 py-2 text-xs font-medium text-[var(--psc-ink)] hover:border-[var(--psc-accent)]"
                    }
                  >
                    {step.label}
                  </button>
                ))}
              </div>
            </div>
          );
        }

        if (param.kind === "boolean") {
          return (
            <label
              key={param.key}
              className="flex cursor-pointer items-center justify-between gap-3 rounded border border-[var(--psc-border)] bg-white px-3 py-2.5"
            >
              <span className="text-sm font-medium text-[var(--psc-ink)]">{param.label}</span>
              <input
                type="checkbox"
                checked={Boolean(clamped[param.key])}
                onChange={(e) => patch({ [param.key]: e.target.checked })}
                className="h-4 w-4 accent-[var(--psc-accent)]"
              />
            </label>
          );
        }

        if (param.kind === "continuous") {
          const min = param.min ?? 0;
          const max = param.max ?? 100;
          const step = param.step ?? 1;
          const value = Number(clamped[param.key] ?? 0);
          return (
            <label key={param.key} className="block space-y-2">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-[var(--psc-ink)]">{param.label}</span>
                <span className="font-mono text-xs text-[var(--psc-muted)]">
                  {formatContinuousValue(param, value)}
                </span>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => patch({ [param.key]: Number.parseFloat(e.target.value) })}
                className="w-full accent-[var(--psc-accent)]"
              />
              <div className="flex justify-between text-[10px] text-[var(--psc-muted)]">
                <span>
                  {min}
                  {param.suffix ?? ""}
                </span>
                <span>
                  {max}
                  {param.suffix ?? ""}
                </span>
              </div>
            </label>
          );
        }

        return null;
      })}

      {scores ? (
        <div className="rounded border border-[var(--psc-border)] bg-white p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Computed ideology scores
          </p>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-[var(--psc-muted)]">Economic</dt>
              <dd className="font-mono font-semibold text-[var(--psc-ink)]">
                {scores.issue_economic_score > 0 ? "+" : ""}
                {scores.issue_economic_score}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--psc-muted)]">Social</dt>
              <dd className="font-mono font-semibold text-[var(--psc-ink)]">
                {scores.issue_social_score > 0 ? "+" : ""}
                {scores.issue_social_score}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}

      {issueKey === SALES_TAX_ISSUE_KEY && Number(clamped.rate ?? 0) > 0 ? (
        <p className="text-xs text-[var(--psc-muted)]">
          Projected annual local sales tax revenue:{" "}
          <span className="font-mono font-semibold text-[var(--psc-ink)]">
            ${Math.round(projectLocalSalesTaxRevenueUsd(Number(clamped.rate ?? 0)) / 1_000_000).toLocaleString()}M
          </span>
        </p>
      ) : null}
    </fieldset>
  );
}
