"use client";

import { useMemo } from "react";
import {
  MARIJUANA_BILL_SCHEMA,
  MARIJUANA_LEGAL_STATUS_STEPS,
  MARIJUANA_SALES_TAX_MAX,
  MARIJUANA_SALES_TAX_MIN,
  clampMarijuanaStanceParams,
  legalStatusAllowsCommercial,
  projectMarijuanaSalesTaxRevenueUsd,
  scoreMarijuanaOrdinance,
  type MarijuanaLegalStatus,
  type MarijuanaStanceParams,
} from "@/lib/marijuana-ordinance-scoring";
import {
  ordinalStepIndex,
  paramRuleSatisfied,
} from "@/lib/city-ordinance-param-schema";

type Props = {
  params: MarijuanaStanceParams;
  onChange: (params: MarijuanaStanceParams) => void;
  annualCityGdpUsd?: number;
};

const ORDINAL_STEPS_BY_KEY = {
  legal_status: MARIJUANA_LEGAL_STATUS_STEPS,
};

export function MarijuanaOrdinanceParamsForm({ params, onChange, annualCityGdpUsd = 0 }: Props) {
  const clamped = useMemo(() => clampMarijuanaStanceParams(params), [params]);
  const scores = useMemo(() => scoreMarijuanaOrdinance(clamped), [clamped]);
  const revenueUsd = useMemo(
    () => projectMarijuanaSalesTaxRevenueUsd(clamped, annualCityGdpUsd),
    [clamped, annualCityGdpUsd],
  );

  const showCommercial = paramRuleSatisfied(
    clamped as Record<string, unknown>,
    MARIJUANA_BILL_SCHEMA.parameters.find((p) => p.key === "commercial_sale_allowed")?.visibleWhen,
    ordinalStepIndex,
    ORDINAL_STEPS_BY_KEY,
  );
  const showSalesTax = paramRuleSatisfied(
    clamped as Record<string, unknown>,
    MARIJUANA_BILL_SCHEMA.parameters.find((p) => p.key === "sales_tax_rate")?.visibleWhen,
    ordinalStepIndex,
    ORDINAL_STEPS_BY_KEY,
  );

  function patch(next: Partial<MarijuanaStanceParams>) {
    onChange(clampMarijuanaStanceParams({ ...clamped, ...next }));
  }

  return (
    <fieldset className="space-y-4">
      <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
        Policy parameters
      </legend>

      <div className="space-y-2">
        <p className="text-sm font-medium text-[var(--psc-ink)]">Legal status</p>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {MARIJUANA_LEGAL_STATUS_STEPS.map((step) => (
            <button
              key={step.value}
              type="button"
              onClick={() =>
                patch({
                  legal_status: step.value as MarijuanaLegalStatus,
                  ...(ordinalStepIndex(step.value, MARIJUANA_LEGAL_STATUS_STEPS) < 2
                    ? { commercial_sale_allowed: false, sales_tax_rate: 0 }
                    : {}),
                })
              }
              className={
                clamped.legal_status === step.value
                  ? "rounded border border-[var(--psc-accent)] bg-white px-2 py-2 text-xs font-semibold text-[var(--psc-accent)] ring-2 ring-[var(--psc-accent)]/30"
                  : "rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2 py-2 text-xs font-medium text-[var(--psc-ink)] hover:border-[var(--psc-accent)]"
              }
            >
              {step.label}
            </button>
          ))}
        </div>
      </div>

      {showCommercial ? (
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded border border-[var(--psc-border)] bg-white px-3 py-2.5">
          <span className="text-sm font-medium text-[var(--psc-ink)]">Licensed commercial sales</span>
          <input
            type="checkbox"
            checked={clamped.commercial_sale_allowed}
            disabled={!legalStatusAllowsCommercial(clamped.legal_status)}
            onChange={(e) =>
              patch({
                commercial_sale_allowed: e.target.checked,
                ...(e.target.checked ? {} : { sales_tax_rate: 0 }),
              })
            }
            className="h-4 w-4 accent-[var(--psc-accent)]"
          />
        </label>
      ) : null}

      {showSalesTax ? (
        <label className="block space-y-2">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium text-[var(--psc-ink)]">Cannabis sales tax</span>
            <span className="font-mono text-xs text-[var(--psc-muted)]">
              {clamped.sales_tax_rate.toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            min={MARIJUANA_SALES_TAX_MIN}
            max={MARIJUANA_SALES_TAX_MAX}
            step={1}
            value={clamped.sales_tax_rate}
            onChange={(e) => patch({ sales_tax_rate: Number.parseFloat(e.target.value) })}
            className="w-full accent-[var(--psc-accent)]"
          />
          <div className="flex justify-between text-[10px] text-[var(--psc-muted)]">
            <span>{MARIJUANA_SALES_TAX_MIN}%</span>
            <span>{MARIJUANA_SALES_TAX_MAX}%</span>
          </div>
          {revenueUsd > 0 ? (
            <p className="text-xs text-[var(--psc-muted)]">
              Projected annual cannabis tax revenue:{" "}
              <span className="font-mono font-semibold text-[var(--psc-ink)]">
                ${Math.round(revenueUsd / 1000).toLocaleString()}K
              </span>
              {annualCityGdpUsd > 0 ? " (scaled to city GDP)" : " (placeholder market)"}
            </p>
          ) : null}
        </label>
      ) : null}

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded border border-[var(--psc-border)] bg-white px-3 py-2.5">
        <span className="text-sm font-medium text-[var(--psc-ink)]">Prior conviction expungement</span>
        <input
          type="checkbox"
          checked={clamped.expungement}
          onChange={(e) => patch({ expungement: e.target.checked })}
          className="h-4 w-4 accent-[var(--psc-accent)]"
        />
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
          Later legalization steps use an escalating curve — recreational and commercial sales move
          scores more than decriminalization alone.
        </p>
      </div>
    </fieldset>
  );
}
