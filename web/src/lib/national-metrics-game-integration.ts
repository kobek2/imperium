import type { NationalMetricsRow } from "@/lib/national-metrics-types";

export type NationalMetricFieldKey = keyof Omit<
  NationalMetricsRow,
  "fiscal_year_id" | "updated_at" | "updated_by"
>;

/**
 * Single source of truth for *how we want* national metrics to tie to the economy sim.
 *
 * - **Budget (today):** `computeBudgetInfluencedNationalMetrics` in `national-metrics-from-budget.ts` applies
 *   draft appropriation surpluses over minimums to a subset of fields (preview on the federal page only).
 * - **Bills / law:** not auto-wired yet; `billSignals` describes the intended mapping for policy-tagged or
 *   template-keyed acts once we add a post-enactment hook.
 * - **Fiscal year close:** intended to snapshot metrics + apply carry-over rules; still mostly manual via admin forms.
 */

export type IntegrationStrength = "live_preview" | "admin_manual" | "planned";

export type NationalMetricIntegrationRow = {
  metricField: NationalMetricFieldKey;
  label: string;
  /** Which federal `line_items[].key` surpluses feed the preview formula today. */
  budgetLineKeys: string[];
  /** Human intent for legislation — implement via bill template / policy_tags + RPC on `law`. */
  billSignals: string;
  /** What should happen when an FY closes (GDP, tax realization, narrative). */
  fiscalYearClose: string;
  strength: IntegrationStrength;
};

export const NATIONAL_METRIC_INTEGRATION: NationalMetricIntegrationRow[] = [
  {
    metricField: "government_approval",
    label: "Government approval",
    budgetLineKeys: ["(aggregate surplus)", "all lines — underfunded total vs minimum"],
    billSignals: "Major bipartisan wins (+), shutdowns or unfunded mandates (−). Tie to confidence votes or EO themes later.",
    fiscalYearClose:
      "Blend realized surplus vs promised platform; small drift from GDP growth. AG court rulings also nudge approval (+/− 1–2 per ruling) via _rp_court_apply_metric_deltas.",
    strength: "live_preview",
  },
  {
    metricField: "unemployment_rate",
    label: "Unemployment",
    budgetLineKeys: ["infrastructure", "economic_development"],
    billSignals: "Jobs / stimulus templates; labor market regulatory bills.",
    fiscalYearClose: "Compare wallet-sum GDP growth to opening; tighten/loosen a few tenths.",
    strength: "live_preview",
  },
  {
    metricField: "per_capita_income",
    label: "Per capita income",
    budgetLineKeys: [],
    billSignals: "Tax reform + growth bills; long-term should track GDP per active player.",
    fiscalYearClose: "Recompute from economy aggregates, not only appropriations.",
    strength: "planned",
  },
  {
    metricField: "us_debt",
    label: "U.S. debt (sim)",
    budgetLineKeys: [],
    billSignals: "Deficit appropriations vs revenue (if we enable sim debt); debt-ceiling drama bills.",
    fiscalYearClose: "Roll structural deficit into stock; currently held at 0 in preview.",
    strength: "admin_manual",
  },
  {
    metricField: "education_academic_scores",
    label: "Education academic scores",
    budgetLineKeys: ["education"],
    billSignals: "Education template acts; charter / funding reform tags.",
    fiscalYearClose: "Small carry from spend commitment vs outcome (lagged).",
    strength: "live_preview",
  },
  {
    metricField: "education_dropout_rate",
    label: "Education dropout rate",
    budgetLineKeys: [],
    billSignals: "K–12 funding and accountability bills; inverse of scores in long run.",
    fiscalYearClose: "Planned: tie to education spend execution.",
    strength: "planned",
  },
  {
    metricField: "education_higher_ed_enrollment",
    label: "Higher ed enrollment",
    budgetLineKeys: [],
    billSignals: "Higher-ed access / student aid bills.",
    fiscalYearClose: "Planned.",
    strength: "planned",
  },
  {
    metricField: "poverty_percentage",
    label: "Poverty rate",
    budgetLineKeys: ["social_welfare", "healthcare", "education"],
    billSignals: "Anti-poverty, housing, Medicaid expansion style acts.",
    fiscalYearClose: "Moderate lag vs social spend outturn.",
    strength: "live_preview",
  },
  {
    metricField: "poverty_effect",
    label: "Poverty effect index",
    budgetLineKeys: [],
    billSignals: "Welfare reform bills; interpret as depth-of-poverty proxy.",
    fiscalYearClose: "Planned.",
    strength: "planned",
  },
  {
    metricField: "homelessness",
    label: "Homelessness (count)",
    budgetLineKeys: [],
    billSignals: "Housing + HUD-style appropriations; emergency relief line on spikes.",
    fiscalYearClose: "Planned: pair with social_welfare execution.",
    strength: "planned",
  },
  {
    metricField: "healthcare_coverage",
    label: "Healthcare coverage",
    budgetLineKeys: ["social_welfare", "healthcare", "education"],
    billSignals: "Coverage expansion / repeal template bills.",
    fiscalYearClose: "Slow adjustment vs healthcare line execution.",
    strength: "live_preview",
  },
  {
    metricField: "life_expectancy",
    label: "Life expectancy",
    budgetLineKeys: ["social_welfare", "healthcare", "education"],
    billSignals: "Public health, insurance, and preventive care narratives.",
    fiscalYearClose: "Very slow delta; cap annual move.",
    strength: "live_preview",
  },
  {
    metricField: "crime_total",
    label: "Total crimes (sim)",
    budgetLineKeys: ["defense", "relief"],
    billSignals: "Criminal justice, policing, border security template bills.",
    fiscalYearClose:
      "Live: AG court docket rulings nudge crime_total each ruling (small bounded deltas via rp_court_close_case → _rp_court_apply_metric_deltas). Decisive losses raise crime_total ~4%; decisive wins lower it ~4%.",
    strength: "live_preview",
  },
  {
    metricField: "crime_prisoners",
    label: "Prisoners (sim)",
    budgetLineKeys: [],
    billSignals: "Sentencing / prison bills; decoupled from crime_total in long run.",
    fiscalYearClose: "Planned.",
    strength: "planned",
  },
  {
    metricField: "infrastructure_road_quality",
    label: "Road quality",
    budgetLineKeys: [],
    billSignals: "Infrastructure reauthorization; pair with infra appropriations when we split the preview.",
    fiscalYearClose: "Planned.",
    strength: "planned",
  },
  {
    metricField: "infrastructure_road_congestion",
    label: "Road congestion",
    budgetLineKeys: [],
    billSignals: "Transit / congestion pricing bills; inverse of quality in some models.",
    fiscalYearClose: "Planned.",
    strength: "planned",
  },
];

export function integrationStrengthLabel(s: IntegrationStrength): string {
  switch (s) {
    case "live_preview":
      return "Live preview (federal page draft)";
    case "admin_manual":
      return "Manual / admin";
    default:
      return "Planned";
  }
}
