/**
 * Marijuana legalization — multi-parameter ordinance (ordinal + conditional booleans + continuous tax).
 */

import type { OrdinanceIssueScores } from "@/lib/city-ordinance-scoring";
import {
  type OrdinanceBillParamSchema,
  ordinalStepIndex,
} from "@/lib/city-ordinance-param-schema";
import { deriveParametricCoalitionKey } from "@/lib/city-ordinance-parametric";

export type MarijuanaLegalStatus = "illegal" | "decriminalized" | "medical" | "recreational";

export type MarijuanaStanceParams = {
  legal_status: MarijuanaLegalStatus;
  commercial_sale_allowed: boolean;
  sales_tax_rate: number;
  expungement: boolean;
};

export const MARIJUANA_LEGAL_STATUS_STEPS: { value: MarijuanaLegalStatus; label: string }[] = [
  { value: "illegal", label: "Illegal" },
  { value: "decriminalized", label: "Decriminalized" },
  { value: "medical", label: "Medical only" },
  { value: "recreational", label: "Recreational" },
];

export const MARIJUANA_SALES_TAX_MIN = 0;
export const MARIJUANA_SALES_TAX_MAX = 40;

const STATUS_ECON_MAX = 72;
const STATUS_SOC_MAX = 78;
const COMMERCIAL_ECON = 22;
const COMMERCIAL_SOC = -6;
const EXPUNGEMENT_SOC = 28;
const EXPUNGEMENT_ECON = -10;
const TAX_ECON_MAX = 38;
const TAX_SOC_MAX = -12;
const STATUS_EXPONENT = 1.7;

/** Placeholder market when city GDP is unknown (macro / preview). */
export const MARIJUANA_BASE_MARKET_USD = 80_000_000;

export const MARIJUANA_BILL_SCHEMA: OrdinanceBillParamSchema = {
  issueKey: "marijuana_legalization",
  label: "Marijuana legalization",
  parameters: [
    {
      key: "legal_status",
      kind: "ordinal",
      label: "Legal status",
      ordinalSteps: MARIJUANA_LEGAL_STATUS_STEPS,
    },
    {
      key: "commercial_sale_allowed",
      kind: "boolean",
      label: "Licensed commercial sales",
      visibleWhen: [{ param: "legal_status", ordinalGte: 2 }],
    },
    {
      key: "sales_tax_rate",
      kind: "continuous",
      label: "Cannabis sales tax",
      min: MARIJUANA_SALES_TAX_MIN,
      max: MARIJUANA_SALES_TAX_MAX,
      step: 1,
      suffix: "%",
      visibleWhen: [
        { param: "legal_status", ordinalGte: 2 },
        { param: "commercial_sale_allowed", equals: true },
      ],
    },
    {
      key: "expungement",
      kind: "boolean",
      label: "Prior conviction expungement",
    },
  ],
};

export function isMarijuanaIssue(issueKey: string): boolean {
  return issueKey.toLowerCase().trim() === "marijuana_legalization";
}

export function legalStatusOrdinal(status: MarijuanaLegalStatus): number {
  return ordinalStepIndex(status, MARIJUANA_LEGAL_STATUS_STEPS);
}

export function legalStatusAllowsCommercial(status: MarijuanaLegalStatus): boolean {
  return legalStatusOrdinal(status) >= 2;
}

function clampRate(rate: number): number {
  return Math.min(MARIJUANA_SALES_TAX_MAX, Math.max(MARIJUANA_SALES_TAX_MIN, rate));
}

export function clampMarijuanaStanceParams(raw: Partial<MarijuanaStanceParams>): MarijuanaStanceParams {
  const legal_status = MARIJUANA_LEGAL_STATUS_STEPS.some((s) => s.value === raw.legal_status)
    ? (raw.legal_status as MarijuanaLegalStatus)
    : "illegal";

  let commercial_sale_allowed = Boolean(raw.commercial_sale_allowed);
  let sales_tax_rate = clampRate(Number(raw.sales_tax_rate ?? 0));

  if (!legalStatusAllowsCommercial(legal_status)) {
    commercial_sale_allowed = false;
    sales_tax_rate = 0;
  } else if (!commercial_sale_allowed) {
    sales_tax_rate = 0;
  }

  return {
    legal_status,
    commercial_sale_allowed,
    sales_tax_rate,
    expungement: Boolean(raw.expungement),
  };
}

function escalatingStepScore(stepIndex: number, maxSteps: number, maxScore: number, sign: 1 | -1): number {
  if (stepIndex <= 0) return 0;
  const norm = Math.pow(stepIndex / maxSteps, STATUS_EXPONENT);
  return Math.round(norm * maxScore) * sign;
}

/** Pure scorer — same output contract as property tax scoreOrdinance. */
export function scoreMarijuanaOrdinance(raw: MarijuanaStanceParams): OrdinanceIssueScores {
  const p = clampMarijuanaStanceParams(raw);
  const step = legalStatusOrdinal(p.legal_status);
  const maxStep = MARIJUANA_LEGAL_STATUS_STEPS.length - 1;

  let issue_economic_score = escalatingStepScore(step, maxStep, STATUS_ECON_MAX, -1);
  let issue_social_score = escalatingStepScore(step, maxStep, STATUS_SOC_MAX, 1);

  if (legalStatusAllowsCommercial(p.legal_status) && p.commercial_sale_allowed) {
    issue_economic_score += COMMERCIAL_ECON;
    issue_social_score += COMMERCIAL_SOC;

    if (p.sales_tax_rate > 0) {
      const taxNorm = Math.pow(p.sales_tax_rate / MARIJUANA_SALES_TAX_MAX, STATUS_EXPONENT);
      issue_economic_score += Math.round(taxNorm * TAX_ECON_MAX);
      issue_social_score += Math.round(taxNorm * TAX_SOC_MAX);
    }
  }

  if (p.expungement) {
    issue_social_score += EXPUNGEMENT_SOC;
    issue_economic_score += EXPUNGEMENT_ECON;
  }

  return {
    issue_economic_score: Math.max(-99, Math.min(99, issue_economic_score)),
    issue_social_score: Math.max(-99, Math.min(99, issue_social_score)),
  };
}

export function deriveMarijuanaCoalitionKey(
  issueEconomicScore: number,
): ReturnType<typeof deriveParametricCoalitionKey> {
  return deriveParametricCoalitionKey(issueEconomicScore);
}

export function formatMarijuanaPolicyStatus(raw: Partial<MarijuanaStanceParams>): string {
  if (!raw.legal_status) return "Custom ordinance";
  const p = clampMarijuanaStanceParams(raw);
  const parts = [formatMarijuanaLegalStatus(p.legal_status)];
  if (p.commercial_sale_allowed && p.sales_tax_rate > 0) {
    parts.push(`${p.sales_tax_rate.toFixed(0)}% sales tax`);
  } else if (p.commercial_sale_allowed) {
    parts.push("commercial sales");
  }
  if (p.expungement) parts.push("expungement");
  return parts.join(" · ");
}

export function formatMarijuanaLegalStatus(status: MarijuanaLegalStatus): string {
  return MARIJUANA_LEGAL_STATUS_STEPS.find((s) => s.value === status)?.label ?? status;
}

export function projectMarijuanaSalesTaxRevenueUsd(
  raw: MarijuanaStanceParams,
  annualCityGdpUsd = 0,
): number {
  const p = clampMarijuanaStanceParams(raw);
  if (!legalStatusAllowsCommercial(p.legal_status) || !p.commercial_sale_allowed || p.sales_tax_rate <= 0) {
    return 0;
  }

  const marketBase = annualCityGdpUsd > 0 ? annualCityGdpUsd * 0.2 : MARIJUANA_BASE_MARKET_USD;
  const statusScale = p.legal_status === "recreational" ? 1 : 0.45;
  return marketBase * statusScale * (p.sales_tax_rate / 100);
}

export function buildMarijuanaOrdinanceTitle(params: MarijuanaStanceParams): string {
  const p = clampMarijuanaStanceParams(params);
  const status = formatMarijuanaLegalStatus(p.legal_status);
  if (!legalStatusAllowsCommercial(p.legal_status) || !p.commercial_sale_allowed) {
    return `Marijuana Legalization — ${status}${p.expungement ? ", with expungement" : ""}`;
  }
  return `Marijuana Legalization — ${status}, ${p.sales_tax_rate.toFixed(0)}% sales tax${p.expungement ? ", expungement" : ""}`;
}

export function buildMarijuanaOrdinanceSummary(params: MarijuanaStanceParams): string {
  const p = clampMarijuanaStanceParams(params);
  const parts: string[] = [`Sets city marijuana policy to ${formatMarijuanaLegalStatus(p.legal_status).toLowerCase()}.`];

  if (legalStatusAllowsCommercial(p.legal_status) && p.commercial_sale_allowed) {
    parts.push(
      `Authorizes licensed dispensaries with a ${p.sales_tax_rate.toFixed(0)}% local cannabis sales tax.`,
    );
    const rev = projectMarijuanaSalesTaxRevenueUsd(p);
    if (rev > 0) {
      parts.push(`Projects roughly $${Math.round(rev / 1000).toLocaleString()}K in annual cannabis tax revenue.`);
    }
  } else if (legalStatusAllowsCommercial(p.legal_status)) {
    parts.push("Does not authorize licensed commercial sales.");
  }

  if (p.expungement) {
    parts.push("Creates a pathway to expunge prior low-level marijuana convictions.");
  }

  return parts.join(" ");
}

/** Registered multi-parameter bill schemas (add future bill types here). */
export const PARAMETRIC_BILL_SCHEMAS: OrdinanceBillParamSchema[] = [MARIJUANA_BILL_SCHEMA];
