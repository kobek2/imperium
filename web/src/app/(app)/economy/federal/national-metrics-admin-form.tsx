"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateNationalMetrics } from "@/app/actions/national-metrics";
import type { NationalMetricsRow } from "@/lib/national-metrics-types";

type Num = number | null;

function toNum(v: string): Num {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function NationalMetricsAdminForm({
  fiscalYearId,
  initial,
}: {
  fiscalYearId: string;
  initial: NationalMetricsRow | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <section
      key={`nm-admin-${fiscalYearId}-${initial?.updated_at ?? "none"}`}
      className="space-y-4 rounded border border-emerald-800/30 bg-emerald-50/50 p-6"
    >
      <div>
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">National metrics (admin)</h2>
        <p className="mt-1 text-xs text-[var(--psc-muted)]">
          These values power the Directory “Nation” snapshot. Leave a field empty to keep the previous value on save.
        </p>
      </div>
      {flash ? (
        <p
          role="status"
          className={`rounded border px-3 py-2 text-sm ${flash.ok ? "border-emerald-700/40 bg-white" : "border-rose-300 bg-rose-50 text-rose-950"}`}
        >
          {flash.message}
        </p>
      ) : null}
      <form
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            setFlash(null);
            const patch = {
              government_approval: toNum(String(fd.get("government_approval") ?? "")),
              unemployment_rate: toNum(String(fd.get("unemployment_rate") ?? "")),
              per_capita_income: toNum(String(fd.get("per_capita_income") ?? "")),
              us_debt: toNum(String(fd.get("us_debt") ?? "")),
              education_academic_scores: toNum(String(fd.get("education_academic_scores") ?? "")),
              education_dropout_rate: toNum(String(fd.get("education_dropout_rate") ?? "")),
              education_higher_ed_enrollment: toNum(String(fd.get("education_higher_ed_enrollment") ?? "")),
              poverty_percentage: toNum(String(fd.get("poverty_percentage") ?? "")),
              poverty_effect: toNum(String(fd.get("poverty_effect") ?? "")),
              homelessness: toNum(String(fd.get("homelessness") ?? "")),
              healthcare_coverage: toNum(String(fd.get("healthcare_coverage") ?? "")),
              life_expectancy: toNum(String(fd.get("life_expectancy") ?? "")),
              crime_total: toNum(String(fd.get("crime_total") ?? "")),
              crime_prisoners: toNum(String(fd.get("crime_prisoners") ?? "")),
              infrastructure_road_quality: toNum(String(fd.get("infrastructure_road_quality") ?? "")),
              infrastructure_road_congestion: toNum(String(fd.get("infrastructure_road_congestion") ?? "")),
            };
            const r = await updateNationalMetrics(fiscalYearId, patch);
            setFlash({ ok: r.ok, message: r.message });
            if (r.ok) router.refresh();
          });
        }}
      >
        <Field label="Government approval %" name="government_approval" defaultValue={initial?.government_approval ?? null} />
        <Field label="Unemployment %" name="unemployment_rate" defaultValue={initial?.unemployment_rate ?? null} />
        <Field label="Per capita income ($)" name="per_capita_income" defaultValue={initial?.per_capita_income ?? null} />
        <Field label="U.S. debt ($)" name="us_debt" defaultValue={initial?.us_debt ?? null} />
        <Field label="Academic scores (/10)" name="education_academic_scores" defaultValue={initial?.education_academic_scores ?? null} />
        <Field label="Dropout %" name="education_dropout_rate" defaultValue={initial?.education_dropout_rate ?? null} />
        <Field label="Higher ed enrollment %" name="education_higher_ed_enrollment" defaultValue={initial?.education_higher_ed_enrollment ?? null} />
        <Field label="Poverty %" name="poverty_percentage" defaultValue={initial?.poverty_percentage ?? null} />
        <Field label="Poverty effect %" name="poverty_effect" defaultValue={initial?.poverty_effect ?? null} />
        <Field label="Homelessness (count)" name="homelessness" defaultValue={initial?.homelessness ?? null} />
        <Field label="Health coverage %" name="healthcare_coverage" defaultValue={initial?.healthcare_coverage ?? null} />
        <Field label="Life expectancy (years)" name="life_expectancy" defaultValue={initial?.life_expectancy ?? null} />
        <Field label="Total crimes" name="crime_total" defaultValue={initial?.crime_total ?? null} />
        <Field label="Prisoners" name="crime_prisoners" defaultValue={initial?.crime_prisoners ?? null} />
        <Field label="Road quality %" name="infrastructure_road_quality" defaultValue={initial?.infrastructure_road_quality ?? null} />
        <Field label="Road congestion %" name="infrastructure_road_congestion" defaultValue={initial?.infrastructure_road_congestion ?? null} />
        <div className="sm:col-span-2 lg:col-span-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded border border-emerald-900 bg-emerald-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save national metrics"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: Num;
}) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-[var(--psc-muted)]">
      {label}
      <input
        name={name}
        type="text"
        inputMode="decimal"
        defaultValue={defaultValue == null ? "" : String(defaultValue)}
        className="rounded border border-[var(--psc-border)] bg-white px-2 py-2 font-mono text-sm text-[var(--psc-ink)]"
      />
    </label>
  );
}
