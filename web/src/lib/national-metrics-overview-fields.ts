import type { NationalMetricsRow } from "@/lib/national-metrics-types";

export type MetricFormat = "pct1" | "pct1_0" | "money0" | "int0" | "score1" | "years2";

export type NationalMetricFieldDef = {
  field: keyof NationalMetricsRow;
  label: string;
  format: MetricFormat;
  /** Grouping for sub-tabs (Political Process–style). */
  category: "overview" | "economy" | "education" | "society" | "crime" | "infrastructure";
};

export const NATIONAL_METRIC_FIELD_DEFS: NationalMetricFieldDef[] = [
  { field: "government_approval", label: "Government approval", format: "pct1", category: "overview" },
  { field: "unemployment_rate", label: "Unemployment rate", format: "pct1", category: "economy" },
  { field: "per_capita_income", label: "Per capita income", format: "money0", category: "economy" },
  { field: "us_debt", label: "U.S. debt (sim)", format: "money0", category: "economy" },
  { field: "education_academic_scores", label: "Academic scores", format: "score1", category: "education" },
  { field: "education_dropout_rate", label: "Dropout rate", format: "pct1", category: "education" },
  { field: "education_higher_ed_enrollment", label: "Higher ed enrollment", format: "pct1_0", category: "education" },
  { field: "poverty_percentage", label: "Poverty rate", format: "pct1", category: "society" },
  { field: "poverty_effect", label: "Poverty effect", format: "pct1", category: "society" },
  { field: "homelessness", label: "Homelessness", format: "int0", category: "society" },
  { field: "healthcare_coverage", label: "Health coverage", format: "pct1", category: "society" },
  { field: "life_expectancy", label: "Life expectancy", format: "years2", category: "society" },
  { field: "crime_total", label: "Total crimes (sim)", format: "int0", category: "crime" },
  { field: "crime_prisoners", label: "Prisoners (sim)", format: "int0", category: "crime" },
  { field: "infrastructure_road_quality", label: "Road quality", format: "pct1", category: "infrastructure" },
  { field: "infrastructure_road_congestion", label: "Road congestion", format: "pct1", category: "infrastructure" },
];

export function formatMetricValue(v: number | null | undefined, format: MetricFormat): string {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  switch (format) {
    case "pct1":
      return `${n.toFixed(1)}%`;
    case "pct1_0":
      return `${n.toFixed(1)}%`;
    case "money0":
      return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    case "int0":
      return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    case "score1":
      return `${n.toFixed(1)}/10`;
    case "years2":
      return `${n.toFixed(2)} yrs`;
    default:
      return String(n);
  }
}

export function metricNumeric(m: NationalMetricsRow | null, field: keyof NationalMetricsRow): number | null {
  if (!m) return null;
  const v = m[field];
  if (v == null || Number.isNaN(Number(v))) return null;
  return Number(v);
}
