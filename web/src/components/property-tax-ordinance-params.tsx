"use client";

import { useMemo } from "react";
import {
  PROPERTY_TAX_EARMARK_MAX,
  PROPERTY_TAX_EARMARK_MIN,
  PROPERTY_TAX_RATE_DELTA_MAX,
  PROPERTY_TAX_RATE_DELTA_MIN,
  scoreOrdinance,
  type PropertyTaxStanceParams,
} from "@/lib/city-ordinance-scoring";

type Props = {
  params: PropertyTaxStanceParams;
  onChange: (params: PropertyTaxStanceParams) => void;
};

export function PropertyTaxOrdinanceParamsForm({ params, onChange }: Props) {
  const scores = useMemo(
    () => scoreOrdinance(params),
    [params.rate_delta, params.earmark_services_pct],
  );

  return (
    <fieldset className="space-y-4">
      <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
        Rate &amp; earmark
      </legend>

      <label className="block space-y-2">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium text-[var(--psc-ink)]">Rate change (percentage points)</span>
          <span className="font-mono text-xs text-[var(--psc-muted)]">
            {params.rate_delta > 0 ? "+" : ""}
            {params.rate_delta.toFixed(1)} pp
          </span>
        </div>
        <input
          type="range"
          min={PROPERTY_TAX_RATE_DELTA_MIN}
          max={PROPERTY_TAX_RATE_DELTA_MAX}
          step={0.5}
          value={params.rate_delta}
          onChange={(e) =>
            onChange({ ...params, rate_delta: Number.parseFloat(e.target.value) })
          }
          className="w-full accent-[var(--psc-accent)]"
        />
        <div className="flex justify-between text-[10px] text-[var(--psc-muted)]">
          <span>{PROPERTY_TAX_RATE_DELTA_MIN}% cut</span>
          <span>hold</span>
          <span>+{PROPERTY_TAX_RATE_DELTA_MAX}% hike</span>
        </div>
      </label>

      <label className="block space-y-2">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium text-[var(--psc-ink)]">Services earmark</span>
          <span className="font-mono text-xs text-[var(--psc-muted)]">
            {Math.round(params.earmark_services_pct)}%
          </span>
        </div>
        <input
          type="range"
          min={PROPERTY_TAX_EARMARK_MIN}
          max={PROPERTY_TAX_EARMARK_MAX}
          step={5}
          value={params.earmark_services_pct}
          onChange={(e) =>
            onChange({ ...params, earmark_services_pct: Number.parseFloat(e.target.value) })
          }
          className="w-full accent-[var(--psc-accent)]"
        />
        <div className="flex justify-between text-[10px] text-[var(--psc-muted)]">
          <span>General fund / relief</span>
          <span>Sanitation, snow removal, core services</span>
        </div>
      </label>

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
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--psc-muted)]">
          Rate uses a power curve — small moves stay modest; large hikes or cuts escalate sharply.
        </p>
      </div>
    </fieldset>
  );
}