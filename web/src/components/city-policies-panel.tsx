"use client";

import { useMemo, useState } from "react";
import { buildCityPolicyStatuses, type CityPolicyStatus } from "@/lib/city-policy-status";
import {
  POLICY_FILTER_CATEGORIES,
  POLICY_TONE_LEGEND,
  policyCategoryShortLabel,
  policyDisplayTone,
  policyStatusPillClass,
} from "@/lib/city-policies-presentation";
import type { OrdinanceProposalRow } from "@/lib/city-office-data";

function ChangedIndicator({ changed }: { changed: boolean }) {
  if (!changed) {
    return <span className="text-slate-300" aria-hidden>—</span>;
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--psc-accent)]"
      title="Changed by council ordinance"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--psc-accent)]" aria-hidden />
      <span className="sr-only">Changed by ordinance</span>
    </span>
  );
}

function PolicyTableRow({ policy }: { policy: CityPolicyStatus }) {
  const tone = policyDisplayTone(policy);

  return (
    <tr className="border-b border-[var(--psc-border)]/60 last:border-0 hover:bg-[var(--psc-canvas)]/60">
      <td className="whitespace-nowrap px-3 py-2.5">
        <span className="inline-block rounded border border-[var(--psc-border)] bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          {policyCategoryShortLabel(policy.category)}
        </span>
      </td>
      <td className="px-3 py-2.5 text-sm font-medium text-[var(--psc-ink)]">{policy.label}</td>
      <td className="px-3 py-2.5">
        <span
          className={`inline-block max-w-[16rem] rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-snug ${policyStatusPillClass(tone)}`}
        >
          {policy.status}
        </span>
      </td>
      <td className="px-3 py-2.5 text-center">
        <ChangedIndicator changed={policy.isEnacted} />
      </td>
    </tr>
  );
}

export function CityPoliciesPanel({ ordinances }: { ordinances: OrdinanceProposalRow[] }) {
  const policies = buildCityPolicyStatuses(ordinances);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [changedOnly, setChangedOnly] = useState(false);

  const filtered = useMemo(() => {
    let rows = policies;
    if (categoryFilter !== "all") {
      rows = rows.filter((p) => p.category === categoryFilter);
    }
    if (changedOnly) {
      rows = rows.filter((p) => p.isEnacted);
    }
    return [...rows].sort((a, b) => {
      const cat = a.categoryLabel.localeCompare(b.categoryLabel);
      if (cat !== 0) return cat;
      return a.label.localeCompare(b.label);
    });
  }, [policies, categoryFilter, changedOnly]);

  const enactedCount = policies.filter((p) => p.isEnacted).length;

  return (
    <section className="space-y-4">
      <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">City policies</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--psc-muted)]">
          Current law and baseline city rules. Rows marked with a dot were updated when the mayor signed
          council legislation.
        </p>
        <p className="mt-2 text-xs text-[var(--psc-muted)]">
          {policies.length} policies · {enactedCount} changed by council action
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {POLICY_TONE_LEGEND.map(({ tone, label }) => (
            <span
              key={tone}
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${policyStatusPillClass(tone)}`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--psc-border)] px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {POLICY_FILTER_CATEGORIES.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setCategoryFilter(key)}
                className={
                  categoryFilter === key
                    ? "rounded bg-[var(--psc-ink)] px-2.5 py-1 text-xs font-semibold text-white"
                    : "rounded border border-[var(--psc-border)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--psc-ink)] hover:border-[var(--psc-accent)]"
                }
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--psc-muted)]">
            <input
              type="checkbox"
              checked={changedOnly}
              onChange={(e) => setChangedOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--psc-accent)]"
            />
            Changed only
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-[var(--psc-border)] bg-[var(--psc-canvas)] text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Policy</th>
                <th className="px-3 py-2">Status</th>
                <th className="w-16 px-3 py-2 text-center">Changed</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length > 0 ? (
                filtered.map((policy) => <PolicyTableRow key={policy.key} policy={policy} />)
              ) : (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-sm text-[var(--psc-muted)]">
                    No policies match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="border-t border-[var(--psc-border)] px-3 py-2 text-[10px] text-[var(--psc-muted)]">
          Showing {filtered.length} of {policies.length}
        </p>
      </div>
    </section>
  );
}
