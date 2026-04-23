import type { NationalMetricsRow } from "@/lib/national-metrics-types";

function cell(n: number | null | undefined, suffix = "", decimals = 1): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (suffix === "%") return `${v.toFixed(decimals)}%`;
  if (suffix === "$") return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return v.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

export function NationalMetricsDisplay({
  m,
  compact = false,
}: {
  m: NationalMetricsRow | null;
  compact?: boolean;
}) {
  if (!m) {
    return (
      <p className="text-sm text-[var(--psc-muted)]">
        National metrics are not configured for this fiscal year yet.
      </p>
    );
  }

  const grid = compact
    ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className={`${grid} text-sm`}>
      <MetricBlock title="Government approval" value={m.government_approval != null ? `${Number(m.government_approval).toFixed(1)}%` : "—"} />
      <MetricBlock title="Unemployment" value={cell(m.unemployment_rate, "%")} />
      <MetricBlock title="Per capita income" value={cell(m.per_capita_income, "$")} />
      <MetricBlock title="U.S. debt (sim)" value={cell(m.us_debt, "$")} />
      <MetricBlock title="Academic scores" value={m.education_academic_scores != null ? `${Number(m.education_academic_scores).toFixed(1)}/10` : "—"} />
      <MetricBlock title="Dropout rate" value={cell(m.education_dropout_rate, "%")} />
      <MetricBlock title="Higher ed enrollment" value={cell(m.education_higher_ed_enrollment, "%")} />
      <MetricBlock title="Poverty rate" value={cell(m.poverty_percentage, "%")} />
      <MetricBlock title="Poverty effect" value={cell(m.poverty_effect, "%")} />
      <MetricBlock title="Homelessness" value={m.homelessness != null ? Number(m.homelessness).toLocaleString() : "—"} />
      <MetricBlock title="Health coverage" value={cell(m.healthcare_coverage, "%")} />
      <MetricBlock title="Life expectancy" value={m.life_expectancy != null ? `${Number(m.life_expectancy).toFixed(2)} yrs` : "—"} />
      <MetricBlock title="Total crimes (sim)" value={m.crime_total != null ? Number(m.crime_total).toLocaleString() : "—"} />
      <MetricBlock title="Prisoners (sim)" value={m.crime_prisoners != null ? Number(m.crime_prisoners).toLocaleString() : "—"} />
      <MetricBlock title="Road quality" value={cell(m.infrastructure_road_quality, "%")} />
      <MetricBlock title="Road congestion" value={cell(m.infrastructure_road_congestion, "%")} />
    </div>
  );
}

function MetricBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded border border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-ink)_3%,transparent)] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">{title}</p>
      <p className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--psc-ink)]">{value}</p>
    </div>
  );
}
