/**
 * Parametric ordinance bill definitions (bills 2–11 from the expansion spec).
 * Bill #1 (policing) lives in policing-community-programs-scoring.ts.
 */

import type { OrdinanceBillParamSchema } from "@/lib/city-ordinance-param-schema";
import { ordinalStepIndex } from "@/lib/city-ordinance-param-schema";
import {
  clampIssueScores,
  clampNumber,
  ordinalAnchorScore,
  PARAM_SCORE_EXPONENT,
  powerCurveNorm,
  signedContinuousScore,
} from "@/lib/city-ordinance-param-scoring-utils";
import type { PolicyVariableDelta } from "@/lib/city-metrics-engine";
import {
  createParametricBill,
  registerRequiredKeys,
  trackParametricIssueKey,
} from "@/lib/parametric-bill-factory";
import type { ParametricBillDefinition } from "@/lib/city-ordinance-param-registry-types";

// ─── 2. Sentencing & Bail Reform ───────────────────────────────────────────

export const SENTENCING_ISSUE_KEY = "sentencing_bail_reform";

type SentencingParams = { sentencing_severity: number; cash_bail: boolean };

const SENTENCING_DEFAULTS: SentencingParams = { sentencing_severity: 50, cash_bail: false };

function clampSentencing(raw: Partial<SentencingParams>): SentencingParams {
  return {
    sentencing_severity: clampNumber(Number(raw.sentencing_severity ?? 50), 0, 100),
    cash_bail: Boolean(raw.cash_bail),
  };
}

export const SENTENCING_BILL = createParametricBill({
  issueKey: SENTENCING_ISSUE_KEY,
  schema: {
    issueKey: SENTENCING_ISSUE_KEY,
    label: "Sentencing & bail reform",
    parameters: [
      { key: "sentencing_severity", kind: "continuous", label: "Sentencing severity", min: 0, max: 100, step: 5, suffix: "" },
      { key: "cash_bail", kind: "boolean", label: "Eliminate cash bail" },
    ],
  } satisfies OrdinanceBillParamSchema,
  defaults: SENTENCING_DEFAULTS,
  clamp: clampSentencing,
  score: (p) => {
    const sevNorm = powerCurveNorm(p.sentencing_severity - 50, -50, 50);
    const econ = Math.round(sevNorm * 35);
    const soc = Math.round(sevNorm * 40) + (p.cash_bail ? -25 : 0);
    return clampIssueScores({ issue_economic_score: econ, issue_social_score: soc });
  },
  policyDeltas: (p) => ({
    community_programs: p.cash_bail ? 5 : 0,
    police_funding: Math.round(powerCurveNorm(p.sentencing_severity, 0, 100) * 6),
  }),
  buildTitle: (p) => `Sentencing & Bail Reform — severity ${p.sentencing_severity}${p.cash_bail ? ", no cash bail" : ""}`,
  buildSummary: (p) =>
    `Sets sentencing severity to ${p.sentencing_severity}/100.${p.cash_bail ? " Eliminates cash bail for most misdemeanors." : " Retains cash bail."}`,
  formatStatus: (p) =>
    `${p.sentencing_severity >= 60 ? "Strict" : p.sentencing_severity <= 40 ? "Lenient" : "Moderate"} sentencing${p.cash_bail ? " · no cash bail" : ""}`,
});

// ─── 3. Surveillance & Policing Technology ─────────────────────────────────

export const SURVEILLANCE_ISSUE_KEY = "surveillance_policing_technology";

type SurveillanceParams = { camera_coverage: number; facial_recognition: boolean };

const SURVEILLANCE_DEFAULTS: SurveillanceParams = { camera_coverage: 0, facial_recognition: false };

function clampSurveillance(raw: Partial<SurveillanceParams>): SurveillanceParams {
  const camera_coverage = clampNumber(Number(raw.camera_coverage ?? 0), 0, 100);
  return {
    camera_coverage,
    facial_recognition: camera_coverage > 0 ? Boolean(raw.facial_recognition) : false,
  };
}

export const SURVEILLANCE_BILL = createParametricBill({
  issueKey: SURVEILLANCE_ISSUE_KEY,
  schema: {
    issueKey: SURVEILLANCE_ISSUE_KEY,
    label: "Surveillance & policing technology",
    parameters: [
      { key: "camera_coverage", kind: "continuous", label: "Camera coverage", min: 0, max: 100, step: 5, suffix: "%" },
      {
        key: "facial_recognition",
        kind: "boolean",
        label: "Facial recognition enabled",
        visibleWhen: [{ param: "camera_coverage", continuousGt: 0 }],
      },
    ],
  } satisfies OrdinanceBillParamSchema,
  defaults: SURVEILLANCE_DEFAULTS,
  clamp: clampSurveillance,
  score: (p) => {
    const cov = powerCurveNorm(p.camera_coverage, 0, 100);
    let econ = Math.round(cov * 28);
    let soc = Math.round(cov * 35);
    if (p.facial_recognition) {
      econ += 12;
      soc += 20;
    }
    return clampIssueScores({ issue_economic_score: econ, issue_social_score: soc });
  },
  policyDeltas: (p) => ({
    police_funding: Math.round(powerCurveNorm(p.camera_coverage, 0, 100) * 5),
    community_programs: p.facial_recognition ? -3 : 0,
  }),
  buildTitle: (p) =>
    `Surveillance Policy — ${p.camera_coverage.toFixed(0)}% coverage${p.facial_recognition ? ", facial recognition" : ""}`,
  buildSummary: (p) =>
    `Authorizes public-area camera coverage at ${p.camera_coverage.toFixed(0)}%.${p.facial_recognition ? " Permits facial recognition on feeds." : " No facial recognition."}`,
  formatStatus: (p) =>
    `${p.camera_coverage.toFixed(0)}% cameras${p.facial_recognition ? " · facial recognition" : ""}`,
});

// ─── 4. Minimum Wage ───────────────────────────────────────────────────────

export const MIN_WAGE_ISSUE_KEY = "minimum_wage";

type MinWageParams = { wage_floor: number };

const MIN_WAGE_DEFAULTS: MinWageParams = { wage_floor: 15 };

function clampMinWage(raw: Partial<MinWageParams>): MinWageParams {
  return { wage_floor: clampNumber(Number(raw.wage_floor ?? 15), 15, 30) };
}

export const MIN_WAGE_BILL = createParametricBill({
  issueKey: MIN_WAGE_ISSUE_KEY,
  schema: {
    issueKey: MIN_WAGE_ISSUE_KEY,
    label: "City minimum wage",
    parameters: [
      { key: "wage_floor", kind: "continuous", label: "Minimum wage floor", min: 15, max: 30, step: 0.5, suffix: "/hr" },
    ],
  } satisfies OrdinanceBillParamSchema,
  defaults: MIN_WAGE_DEFAULTS,
  clamp: clampMinWage,
  score: (p) => {
    const norm = powerCurveNorm(p.wage_floor - 15, 0, 15);
    return clampIssueScores({
      issue_economic_score: -Math.round(norm * 75),
      issue_social_score: -Math.round(norm * 42),
    });
  },
  policyDeltas: (p) => ({
    housing_subsidy: Math.round(powerCurveNorm(p.wage_floor - 15, 0, 15) * 5),
    business_regulation: Math.round(powerCurveNorm(p.wage_floor - 15, 0, 15) * 4),
  }),
  buildTitle: (p) => `City Minimum Wage — $${p.wage_floor.toFixed(2)}/hr`,
  buildSummary: (p) => `Sets the municipal minimum wage to $${p.wage_floor.toFixed(2)} per hour for private employers in NYC.`,
  formatStatus: (p) => `$${p.wage_floor.toFixed(2)}/hr floor`,
});

// ─── 5. Rent Control / Housing Affordability ───────────────────────────────

export const RENT_CONTROL_ISSUE_KEY = "rent_control_housing";

type RentControlParams = { rent_increase_cap: number; affordable_unit_mandate_pct: number };

const RENT_CONTROL_DEFAULTS: RentControlParams = { rent_increase_cap: 15, affordable_unit_mandate_pct: 0 };

function clampRentControl(raw: Partial<RentControlParams>): RentControlParams {
  const rent_increase_cap = clampNumber(Number(raw.rent_increase_cap ?? 15), 0, 15);
  const capped = rent_increase_cap < 12;
  return {
    rent_increase_cap,
    affordable_unit_mandate_pct: capped
      ? clampNumber(Number(raw.affordable_unit_mandate_pct ?? 0), 0, 30)
      : 0,
  };
}

export const RENT_CONTROL_BILL = createParametricBill({
  issueKey: RENT_CONTROL_ISSUE_KEY,
  schema: {
    issueKey: RENT_CONTROL_ISSUE_KEY,
    label: "Rent control & housing affordability",
    parameters: [
      {
        key: "rent_increase_cap",
        kind: "continuous",
        label: "Annual rent increase cap",
        min: 0,
        max: 15,
        step: 1,
        suffix: "%",
      },
      {
        key: "affordable_unit_mandate_pct",
        kind: "continuous",
        label: "Affordable unit mandate",
        min: 0,
        max: 30,
        step: 1,
        suffix: "%",
        visibleWhen: [{ param: "rent_increase_cap", continuousLt: 12 }],
      },
    ],
  } satisfies OrdinanceBillParamSchema,
  defaults: RENT_CONTROL_DEFAULTS,
  clamp: clampRentControl,
  score: (p) => {
    const strictness = powerCurveNorm(12 - p.rent_increase_cap, 0, 12);
    const mandate = powerCurveNorm(p.affordable_unit_mandate_pct, 0, 30);
    return clampIssueScores({
      issue_economic_score: Math.round((strictness + mandate) * 30),
      issue_social_score: -Math.round((strictness * 40 + mandate * 25)),
    });
  },
  policyDeltas: (p) => ({
    housing_subsidy: Math.round(powerCurveNorm(12 - p.rent_increase_cap, 0, 12) * 8 + powerCurveNorm(p.affordable_unit_mandate_pct, 0, 30) * 4),
    business_regulation: Math.round(powerCurveNorm(12 - p.rent_increase_cap, 0, 12) * 5),
  }),
  buildTitle: (p) =>
    `Rent Control — ${p.rent_increase_cap <= 0 ? "frozen" : `${p.rent_increase_cap.toFixed(0)}% cap`}${p.affordable_unit_mandate_pct > 0 ? `, ${p.affordable_unit_mandate_pct.toFixed(0)}% mandate` : ""}`,
  buildSummary: (p) =>
    `Caps annual rent increases at ${p.rent_increase_cap.toFixed(0)}%.${p.affordable_unit_mandate_pct > 0 ? ` Requires ${p.affordable_unit_mandate_pct.toFixed(0)}% affordable set-asides on new development.` : ""}`,
  formatStatus: (p) =>
    `${p.rent_increase_cap <= 0 ? "Frozen rents" : `${p.rent_increase_cap.toFixed(0)}% cap`}${p.affordable_unit_mandate_pct > 0 ? ` · ${p.affordable_unit_mandate_pct.toFixed(0)}% mandate` : ""}`,
});

// ─── 6. Small Business Tax Incentives ──────────────────────────────────────

export const SMALL_BIZ_TAX_ISSUE_KEY = "small_business_tax_incentives";

type SmallBizTaxParams = { tax_credit_pct: number; eligibility: string };

const ELIGIBILITY_STEPS = [
  { value: "new_businesses", label: "New businesses only" },
  { value: "under_50_employees", label: "Under 50 employees" },
  { value: "all_businesses", label: "All businesses" },
];

const SMALL_BIZ_TAX_DEFAULTS: SmallBizTaxParams = { tax_credit_pct: 0, eligibility: "new_businesses" };

function clampSmallBizTax(raw: Partial<SmallBizTaxParams>): SmallBizTaxParams {
  const eligibility = ELIGIBILITY_STEPS.some((s) => s.value === raw.eligibility)
    ? String(raw.eligibility)
    : "new_businesses";
  return {
    tax_credit_pct: clampNumber(Number(raw.tax_credit_pct ?? 0), 0, 25),
    eligibility,
  };
}

export const SMALL_BIZ_TAX_BILL = createParametricBill({
  issueKey: SMALL_BIZ_TAX_ISSUE_KEY,
  schema: {
    issueKey: SMALL_BIZ_TAX_ISSUE_KEY,
    label: "Small business tax incentives",
    parameters: [
      { key: "tax_credit_pct", kind: "continuous", label: "Tax credit", min: 0, max: 25, step: 1, suffix: "%" },
      { key: "eligibility", kind: "ordinal", label: "Eligibility", ordinalSteps: ELIGIBILITY_STEPS },
    ],
  } satisfies OrdinanceBillParamSchema,
  defaults: SMALL_BIZ_TAX_DEFAULTS,
  clamp: clampSmallBizTax,
  score: (p) => {
    const credit = powerCurveNorm(p.tax_credit_pct, 0, 25);
    const elig = ordinalStepIndex(p.eligibility, ELIGIBILITY_STEPS);
    const econ = -Math.round(credit * 40 + elig * 8);
    const soc = Math.round(credit * 15);
    return clampIssueScores({ issue_economic_score: econ, issue_social_score: soc });
  },
  policyDeltas: (p) => ({
    business_regulation: -Math.round(powerCurveNorm(p.tax_credit_pct, 0, 25) * 5),
    tax_burden: -Math.round(powerCurveNorm(p.tax_credit_pct, 0, 25) * 4),
  }),
  buildTitle: (p) => {
    const label = ELIGIBILITY_STEPS.find((s) => s.value === p.eligibility)?.label ?? p.eligibility;
    return `Small Business Tax Incentives — ${p.tax_credit_pct.toFixed(0)}% credit (${label})`;
  },
  buildSummary: (p) => {
    const label = ELIGIBILITY_STEPS.find((s) => s.value === p.eligibility)?.label ?? p.eligibility;
    return `Creates a ${p.tax_credit_pct.toFixed(0)}% local business tax credit for ${label.toLowerCase()}.`;
  },
  formatStatus: (p) => {
    const label = ELIGIBILITY_STEPS.find((s) => s.value === p.eligibility)?.label ?? p.eligibility;
    return `${p.tax_credit_pct.toFixed(0)}% credit · ${label}`;
  },
});

// ─── 7. Public Transit Investment ──────────────────────────────────────────

export const TRANSIT_ISSUE_KEY = "public_transit_investment";

type TransitParams = { funding_delta: number; fare_change: number };

const TRANSIT_DEFAULTS: TransitParams = { funding_delta: 0, fare_change: 0 };

function clampTransit(raw: Partial<TransitParams>): TransitParams {
  return {
    funding_delta: clampNumber(Number(raw.funding_delta ?? 0), -20, 50),
    fare_change: clampNumber(Number(raw.fare_change ?? 0), -50, 25),
  };
}

export const TRANSIT_BILL = createParametricBill({
  issueKey: TRANSIT_ISSUE_KEY,
  schema: {
    issueKey: TRANSIT_ISSUE_KEY,
    label: "Public transit investment",
    parameters: [
      { key: "funding_delta", kind: "continuous", label: "Transit funding change", min: -20, max: 50, step: 5, suffix: "%" },
      { key: "fare_change", kind: "continuous", label: "Fare change", min: -50, max: 25, step: 5, suffix: "%" },
    ],
  } satisfies OrdinanceBillParamSchema,
  defaults: TRANSIT_DEFAULTS,
  clamp: clampTransit,
  score: (p) => {
    const fundEcon = signedContinuousScore(p.funding_delta, -20, 50, 45, 35);
    const fareEcon = signedContinuousScore(-p.fare_change, -50, 25, 30, 25);
    const fundSoc = signedContinuousScore(-p.funding_delta, -20, 50, 35, 30);
    const fareSoc = signedContinuousScore(p.fare_change, -50, 25, 25, 20);
    return clampIssueScores({
      issue_economic_score: fundEcon + fareEcon,
      issue_social_score: fundSoc + fareSoc,
    });
  },
  policyDeltas: (p) => ({
    infrastructure_capital: Math.round(powerCurveNorm(Math.max(p.funding_delta, 0), 0, 50) * 7),
    community_programs: Math.round(powerCurveNorm(Math.max(-p.fare_change, 0), 0, 50) * 3),
  }),
  buildTitle: (p) =>
    `Public Transit — ${p.funding_delta >= 0 ? "+" : ""}${p.funding_delta.toFixed(0)}% funding, ${p.fare_change >= 0 ? "+" : ""}${p.fare_change.toFixed(0)}% fares`,
  buildSummary: (p) =>
    `Adjusts city transit subsidy by ${p.funding_delta.toFixed(0)}% and fares by ${p.fare_change.toFixed(0)}% from baseline.`,
  formatStatus: (p) =>
    `${p.funding_delta >= 0 ? "+" : ""}${p.funding_delta.toFixed(0)}% funding · ${p.fare_change >= 0 ? "+" : ""}${p.fare_change.toFixed(0)}% fares`,
});

// ─── 8. School Funding Allocation ────────────────────────────────────────────

export const SCHOOL_FUNDING_ISSUE_KEY = "school_funding";

type SchoolFundingParams = { funding_delta: number; allocation_focus: string };

const ALLOCATION_STEPS = [
  { value: "general", label: "General" },
  { value: "title_i", label: "Title I priority" },
  { value: "universal_pre_k", label: "Universal pre-K priority" },
];

const SCHOOL_FUNDING_DEFAULTS: SchoolFundingParams = { funding_delta: 0, allocation_focus: "general" };

function clampSchoolFunding(raw: Partial<SchoolFundingParams>): SchoolFundingParams {
  const allocation_focus = ALLOCATION_STEPS.some((s) => s.value === raw.allocation_focus)
    ? String(raw.allocation_focus)
    : "general";
  return {
    funding_delta: clampNumber(Number(raw.funding_delta ?? 0), -15, 25),
    allocation_focus,
  };
}

export const SCHOOL_FUNDING_BILL = createParametricBill({
  issueKey: SCHOOL_FUNDING_ISSUE_KEY,
  schema: {
    issueKey: SCHOOL_FUNDING_ISSUE_KEY,
    label: "School funding allocation",
    parameters: [
      { key: "funding_delta", kind: "continuous", label: "Per-pupil funding change", min: -15, max: 25, step: 1, suffix: "%" },
      { key: "allocation_focus", kind: "ordinal", label: "Allocation focus", ordinalSteps: ALLOCATION_STEPS },
    ],
  } satisfies OrdinanceBillParamSchema,
  defaults: SCHOOL_FUNDING_DEFAULTS,
  clamp: clampSchoolFunding,
  score: (p) => {
    const fund = signedContinuousScore(p.funding_delta, -15, 25, 70, 55);
    const focus = ordinalAnchorScore(ordinalStepIndex(p.allocation_focus, ALLOCATION_STEPS), [-20, -35, -45]);
    return clampIssueScores({
      issue_economic_score: fund,
      issue_social_score: fund + focus,
    });
  },
  policyDeltas: (p) => ({
    school_funding: Math.round(signedContinuousScore(p.funding_delta, -15, 25, 10, 8)),
  }),
  buildTitle: (p) => {
    const focus = ALLOCATION_STEPS.find((s) => s.value === p.allocation_focus)?.label ?? p.allocation_focus;
    return `School Funding — ${p.funding_delta >= 0 ? "+" : ""}${p.funding_delta.toFixed(0)}%, ${focus}`;
  },
  buildSummary: (p) => {
    const focus = ALLOCATION_STEPS.find((s) => s.value === p.allocation_focus)?.label ?? p.allocation_focus;
    return `Changes per-pupil funding by ${p.funding_delta.toFixed(0)}% with ${focus.toLowerCase()} priority.`;
  },
  formatStatus: (p) => {
    const focus = ALLOCATION_STEPS.find((s) => s.value === p.allocation_focus)?.label ?? p.allocation_focus;
    return `${p.funding_delta >= 0 ? "+" : ""}${p.funding_delta.toFixed(0)}% · ${focus}`;
  },
});

// ─── 9. School Choice / Charter Expansion ────────────────────────────────────

export const CHARTER_ISSUE_KEY = "charter_school_expansion";

type CharterParams = { charter_cap_change: number; voucher_program: boolean };

const CHARTER_DEFAULTS: CharterParams = { charter_cap_change: 0, voucher_program: false };

function clampCharter(raw: Partial<CharterParams>): CharterParams {
  return {
    charter_cap_change: clampNumber(Number(raw.charter_cap_change ?? 0), -50, 50),
    voucher_program: Boolean(raw.voucher_program),
  };
}

export const CHARTER_BILL = createParametricBill({
  issueKey: CHARTER_ISSUE_KEY,
  schema: {
    issueKey: CHARTER_ISSUE_KEY,
    label: "School choice & charter expansion",
    parameters: [
      { key: "charter_cap_change", kind: "continuous", label: "Charter cap change", min: -50, max: 50, step: 5, suffix: "%" },
      { key: "voucher_program", kind: "boolean", label: "Municipal voucher program" },
    ],
  } satisfies OrdinanceBillParamSchema,
  defaults: CHARTER_DEFAULTS,
  clamp: clampCharter,
  score: (p) => {
    const cap = signedContinuousScore(p.charter_cap_change, -50, 50, 45, 35);
    const voucher = p.voucher_program ? 35 : 0;
    return clampIssueScores({
      issue_economic_score: cap + Math.round(voucher * 0.6),
      issue_social_score: cap + voucher,
    });
  },
  policyDeltas: (p) => ({
    school_funding: Math.round(signedContinuousScore(p.charter_cap_change, -50, 50, 4, 3) + (p.voucher_program ? -2 : 0)),
  }),
  buildTitle: (p) =>
    `Charter & School Choice — ${p.charter_cap_change >= 0 ? "+" : ""}${p.charter_cap_change.toFixed(0)}% cap${p.voucher_program ? ", vouchers" : ""}`,
  buildSummary: (p) =>
    `Adjusts charter school cap by ${p.charter_cap_change.toFixed(0)}%.${p.voucher_program ? " Establishes a municipal voucher program." : ""}`,
  formatStatus: (p) =>
    `${p.charter_cap_change >= 0 ? "+" : ""}${p.charter_cap_change.toFixed(0)}% charter cap${p.voucher_program ? " · vouchers" : ""}`,
});

// ─── 10. Teacher Pay & Class Size ───────────────────────────────────────────

export const TEACHER_ISSUE_KEY = "teacher_pay_class_size";

type TeacherParams = { pay_increase_pct: number; class_size_target: number };

const TEACHER_DEFAULTS: TeacherParams = { pay_increase_pct: 0, class_size_target: 25 };

function clampTeacher(raw: Partial<TeacherParams>): TeacherParams {
  return {
    pay_increase_pct: clampNumber(Number(raw.pay_increase_pct ?? 0), 0, 20),
    class_size_target: clampNumber(Number(raw.class_size_target ?? 25), 15, 35),
  };
}

export const TEACHER_BILL = createParametricBill({
  issueKey: TEACHER_ISSUE_KEY,
  schema: {
    issueKey: TEACHER_ISSUE_KEY,
    label: "Teacher pay & class size",
    parameters: [
      { key: "pay_increase_pct", kind: "continuous", label: "Teacher pay increase", min: 0, max: 20, step: 1, suffix: "%" },
      { key: "class_size_target", kind: "continuous", label: "Class size target", min: 15, max: 35, step: 1, suffix: " students" },
    ],
  } satisfies OrdinanceBillParamSchema,
  defaults: TEACHER_DEFAULTS,
  clamp: clampTeacher,
  score: (p) => {
    const pay = powerCurveNorm(p.pay_increase_pct, 0, 20);
    const sizeNorm = powerCurveNorm(35 - p.class_size_target, 0, 20);
    const econ = -Math.round((pay + sizeNorm) * 35);
    const soc = -Math.round((pay * 30 + sizeNorm * 40));
    return clampIssueScores({ issue_economic_score: econ, issue_social_score: soc });
  },
  policyDeltas: (p) => ({
    school_funding: Math.round(powerCurveNorm(p.pay_increase_pct, 0, 20) * 6 + powerCurveNorm(35 - p.class_size_target, 0, 20) * 4),
  }),
  buildTitle: (p) =>
    `Teacher Pay & Class Size — +${p.pay_increase_pct.toFixed(0)}% pay, ${p.class_size_target.toFixed(0)} students/class`,
  buildSummary: (p) =>
    `Raises teacher compensation by ${p.pay_increase_pct.toFixed(0)}% and sets a ${p.class_size_target.toFixed(0)}-student class size target.`,
  formatStatus: (p) => `+${p.pay_increase_pct.toFixed(0)}% pay · ${p.class_size_target.toFixed(0)} students/class`,
});

// ─── 11. Sales Tax Rate ──────────────────────────────────────────────────────

export const SALES_TAX_ISSUE_KEY = "sales_tax_rate";

type SalesTaxParams = { rate: number };

const SALES_TAX_DEFAULTS: SalesTaxParams = { rate: 0 };

function clampSalesTax(raw: Partial<SalesTaxParams>): SalesTaxParams {
  return { rate: clampNumber(Number(raw.rate ?? 0), 0, 10) };
}

/** Placeholder annual taxable sales base when city GDP unknown. */
export const SALES_TAX_BASE_USD = 12_000_000_000;

export function projectLocalSalesTaxRevenueUsd(rate: number, annualCityGdpUsd = 0): number {
  if (rate <= 0) return 0;
  const base = annualCityGdpUsd > 0 ? annualCityGdpUsd * 0.15 : SALES_TAX_BASE_USD;
  return base * (rate / 100);
}

export const SALES_TAX_BILL = createParametricBill({
  issueKey: SALES_TAX_ISSUE_KEY,
  schema: {
    issueKey: SALES_TAX_ISSUE_KEY,
    label: "Local sales tax rate",
    parameters: [
      { key: "rate", kind: "continuous", label: "Sales tax rate", min: 0, max: 10, step: 0.25, suffix: "%" },
    ],
  } satisfies OrdinanceBillParamSchema,
  defaults: SALES_TAX_DEFAULTS,
  clamp: clampSalesTax,
  score: (p) => {
    const norm = powerCurveNorm(p.rate, 0, 10);
    return clampIssueScores({
      issue_economic_score: Math.round(norm * 55),
      issue_social_score: Math.round(norm * -18),
    });
  },
  policyDeltas: (p) => ({
    tax_burden: Math.round(powerCurveNorm(p.rate, 0, 10) * 7),
  }),
  buildTitle: (p) => `Local Sales Tax — ${p.rate.toFixed(2)}%`,
  buildSummary: (p) => {
    const rev = projectLocalSalesTaxRevenueUsd(p.rate);
    return `Sets the municipal sales tax rate to ${p.rate.toFixed(2)}%.${rev > 0 ? ` Projects roughly $${Math.round(rev / 1_000_000).toLocaleString()}M in annual revenue.` : ""}`;
  },
  formatStatus: (p) => `${p.rate.toFixed(2)}% local sales tax`,
});

// ─── Registry export ─────────────────────────────────────────────────────────

export const EXPANSION_PARAMETRIC_BILLS: ParametricBillDefinition[] = [
  SENTENCING_BILL,
  SURVEILLANCE_BILL,
  MIN_WAGE_BILL,
  RENT_CONTROL_BILL,
  SMALL_BIZ_TAX_BILL,
  TRANSIT_BILL,
  SCHOOL_FUNDING_BILL,
  CHARTER_BILL,
  TEACHER_BILL,
  SALES_TAX_BILL,
];

for (const bill of EXPANSION_PARAMETRIC_BILLS) {
  trackParametricIssueKey(bill.issueKey);
  registerRequiredKeys(
    bill.issueKey,
    bill.schema.parameters.map((p) => p.key),
  );
}

export function scoreParametricBillByIssue(
  issueKey: string,
  params: Record<string, unknown>,
): ReturnType<ParametricBillDefinition["score"]> | null {
  const bill = EXPANSION_PARAMETRIC_BILLS.find((b) => b.issueKey === issueKey);
  return bill ? bill.score(params) : null;
}

export function clampParametricBillByIssue(
  issueKey: string,
  params: Partial<Record<string, unknown>>,
): Record<string, unknown> | null {
  const bill = EXPANSION_PARAMETRIC_BILLS.find((b) => b.issueKey === issueKey);
  return bill ? bill.clamp(params) : null;
}
