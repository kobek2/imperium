/** Row in `national_metrics` (structured simulator stats). */
export type NationalMetricsRow = {
  fiscal_year_id: string;
  government_approval: number | null;
  unemployment_rate: number | null;
  per_capita_income: number | null;
  us_debt: number | null;
  education_academic_scores: number | null;
  education_dropout_rate: number | null;
  education_higher_ed_enrollment: number | null;
  poverty_percentage: number | null;
  poverty_effect: number | null;
  homelessness: number | null;
  healthcare_coverage: number | null;
  life_expectancy: number | null;
  crime_total: number | null;
  crime_prisoners: number | null;
  infrastructure_road_quality: number | null;
  infrastructure_road_congestion: number | null;
  updated_at?: string;
  updated_by?: string | null;
};

export type NationalMetricsHistoryRow = NationalMetricsRow & {
  year_label: string;
  year_index: number;
  fiscal_status: string;
};
