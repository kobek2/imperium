"use client";

import { computeBudgetEffectPreview, hasVisibleEffects } from "@/lib/city-sim-effects";
import type { CityFiscalDepartmentKey } from "@/lib/city-fiscal-data";
import { EffectPreviewRows } from "@/components/effect-preview-rows";

export function BudgetEffectPreview({
  departments,
  deficitMillions,
}: {
  departments: { departmentKey: CityFiscalDepartmentKey; amountMillions: number }[];
  deficitMillions: number;
}) {
  const deltas = computeBudgetEffectPreview(departments, deficitMillions);

  if (!hasVisibleEffects(deltas)) {
    return (
      <p className="text-sm text-[var(--psc-muted)]">
        Enacting at baseline spending levels — minimal metric shift beyond treasury update.
      </p>
    );
  }

  return (
    <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
      <p className="text-sm font-semibold text-[var(--psc-ink)]">
        If enacted, city metrics shift by:
      </p>
      <div className="mt-2">
        <EffectPreviewRows deltas={deltas} />
      </div>
      {deficitMillions < -500 ? (
        <p className="mt-2 text-xs font-medium text-amber-900">
          Large deficit: additional pressure on economy and business climate.
        </p>
      ) : null}
    </div>
  );
}
