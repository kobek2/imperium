/**
 * @see `national-metrics-game-integration.ts` for the full metric ↔ budget ↔ bills ↔ FY-close design grid.
 */
import type { FiscalLineItemRow } from "@/lib/fiscal-budget-types";
import type { NationalMetricsRow } from "@/lib/national-metrics-types";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function lineSurplus(line: FiscalLineItemRow): number {
  const a = Number(line.allocated) || 0;
  const m = Number(line.minimum) || 0;
  return Math.max(0, a - m);
}

function surplusSumForKeys(lines: FiscalLineItemRow[], keys: ReadonlySet<string>): number {
  return lines.reduce((s, l) => s + (keys.has(l.key) ? lineSurplus(l) : 0), 0);
}

/**
 * Neutral “sim nation” baseline when admins have not set metrics yet.
 * Tuned so derived deltas read as modest, plausible swings (not simulation truth).
 */
function neutralBaseline(fiscalYearId: string): NationalMetricsRow {
  return {
    fiscal_year_id: fiscalYearId,
    government_approval: 50,
    unemployment_rate: 4.2,
    per_capita_income: 55_000,
    us_debt: 0,
    education_academic_scores: 6.4,
    education_dropout_rate: 5.5,
    education_higher_ed_enrollment: 62,
    poverty_percentage: 11,
    poverty_effect: 3,
    homelessness: 580_000,
    healthcare_coverage: 91,
    life_expectancy: 78.2,
    crime_total: 8_000_000,
    crime_prisoners: 1_700_000,
    infrastructure_road_quality: 58,
    infrastructure_road_congestion: 42,
  };
}

/**
 * **Preview only** — combines stored admin metrics (or neutral defaults) with simple
 * marginal adjustments from draft line-item surpluses. Does not persist; use for UI
 * and presidential “what-if” until you wire automated fiscal → metrics sync.
 *
 * **Design note:** A production system often separates (a) *structural* indicators updated
 * slowly from macro + legislation, (b) *fiscal impulse* from deficit vs surplus, (c)
 * *program-specific* elasticities (education spend → scores with lags). Starting with
 * transparent surplus-to-delta rules keeps the game legible; you can replace this function
 * with regression weights or scripted events later without changing the DB schema.
 */
export function computeBudgetInfluencedNationalMetrics(
  adminBaseline: NationalMetricsRow | null,
  lines: FiscalLineItemRow[],
  fiscalYearId: string,
): NationalMetricsRow {
  const base = adminBaseline ? { ...adminBaseline, fiscal_year_id: fiscalYearId } : neutralBaseline(fiscalYearId);

  const aggSurplus = lines.reduce((s, l) => s + lineSurplus(l), 0);
  const totalMin = lines.reduce((s, l) => s + (Number(l.minimum) || 0), 0);
  const totalAlloc = lines.reduce((s, l) => s + (Number(l.allocated) || 0), 0);

  const approvalBase = base.government_approval ?? 50;
  const approvalFromSpend = Math.min(20, (aggSurplus / 5_000_000) * 2);
  const underFunded = totalAlloc + 1 < totalMin ? -10 : 0;
  const government_approval = clamp(approvalBase + approvalFromSpend + underFunded, 12, 96);

  const infraEcon = surplusSumForKeys(lines, new Set(["infrastructure", "economic_development"]));
  const unemployment_rate = clamp(
    (base.unemployment_rate ?? 4.2) - Math.min(1.4, infraEcon / 22_000_000),
    2.4,
    12,
  );

  const socialHealthEdu = surplusSumForKeys(
    lines,
    new Set(["social_welfare", "healthcare", "education"]),
  );
  const poverty_percentage = clamp(
    (base.poverty_percentage ?? 11) - Math.min(2.8, socialHealthEdu / 14_000_000),
    4,
    24,
  );
  const healthcare_coverage = clamp(
    (base.healthcare_coverage ?? 91) + Math.min(3.5, socialHealthEdu / 18_000_000),
    78,
    99.5,
  );
  const life_expectancy = clamp(
    (base.life_expectancy ?? 78.2) + Math.min(0.35, socialHealthEdu / 40_000_000),
    76,
    82.5,
  );

  const eduSurplus = surplusSumForKeys(lines, new Set(["education"]));
  const education_academic_scores = clamp(
    (base.education_academic_scores ?? 6.4) + Math.min(0.9, eduSurplus / 12_000_000),
    4,
    9.5,
  );

  const defenseRelief = surplusSumForKeys(lines, new Set(["defense", "relief"]));
  const crime_total = clamp(
    (base.crime_total ?? 8_000_000) - Math.min(400_000, defenseRelief / 50),
    4_000_000,
    14_000_000,
  );

  return {
    ...base,
    government_approval,
    unemployment_rate,
    poverty_percentage,
    healthcare_coverage,
    life_expectancy,
    education_academic_scores,
    crime_total,
    us_debt: 0,
  };
}
