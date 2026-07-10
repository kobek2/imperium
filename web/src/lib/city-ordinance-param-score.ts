/**
 * Routes parametric ordinance scoring by issue_key (property tax + multi-param bills).
 */

import {
  clampPropertyTaxStanceParams,
  isPropertyTaxIssue,
  scoreOrdinance,
  type OrdinanceIssueScores,
  type PropertyTaxStanceParams,
} from "@/lib/city-ordinance-scoring";
import { deriveParametricCoalitionKey } from "@/lib/city-ordinance-parametric";
import {
  getParametricBillDefinition,
  isRegistryParametricIssue,
} from "@/lib/city-ordinance-param-registry";
import {
  buildMarijuanaOrdinanceSummary,
  buildMarijuanaOrdinanceTitle,
  clampMarijuanaStanceParams,
  isMarijuanaIssue,
  scoreMarijuanaOrdinance,
  type MarijuanaStanceParams,
} from "@/lib/marijuana-ordinance-scoring";
import type { OrdinanceStanceKey } from "@/lib/city-ordinance-templates";

export type RegistryStanceParams = Record<string, unknown>;

export type OrdinanceStanceParams =
  | PropertyTaxStanceParams
  | MarijuanaStanceParams
  | RegistryStanceParams;

export const DEFAULT_MARIJUANA_STANCE_PARAMS: MarijuanaStanceParams = {
  legal_status: "illegal",
  commercial_sale_allowed: false,
  sales_tax_rate: 0,
  expungement: false,
};

export function issueUsesParametricScoring(issueKey: string): boolean {
  return (
    isPropertyTaxIssue(issueKey) ||
    isMarijuanaIssue(issueKey) ||
    isRegistryParametricIssue(issueKey)
  );
}

export function defaultStanceParamsForIssue(issueKey: string): OrdinanceStanceParams | null {
  if (isMarijuanaIssue(issueKey)) return { ...DEFAULT_MARIJUANA_STANCE_PARAMS };
  const bill = getParametricBillDefinition(issueKey);
  if (bill) return { ...bill.defaultParams };
  return null;
}

export function clampStanceParamsForIssue(
  issueKey: string,
  raw: Partial<OrdinanceStanceParams>,
): OrdinanceStanceParams | null {
  if (isPropertyTaxIssue(issueKey)) {
    return clampPropertyTaxStanceParams(raw as Partial<PropertyTaxStanceParams>);
  }
  if (isMarijuanaIssue(issueKey)) {
    return clampMarijuanaStanceParams(raw as Partial<MarijuanaStanceParams>);
  }
  const bill = getParametricBillDefinition(issueKey);
  if (bill) return bill.clamp(raw as Partial<Record<string, unknown>>);
  return null;
}

export function scoreOrdinanceByIssue(
  issueKey: string,
  params: OrdinanceStanceParams,
): OrdinanceIssueScores | null {
  if (isPropertyTaxIssue(issueKey)) {
    return scoreOrdinance(clampPropertyTaxStanceParams(params as PropertyTaxStanceParams));
  }
  if (isMarijuanaIssue(issueKey)) {
    return scoreMarijuanaOrdinance(clampMarijuanaStanceParams(params as MarijuanaStanceParams));
  }
  const bill = getParametricBillDefinition(issueKey);
  if (bill) return bill.score(params as Record<string, unknown>);
  return null;
}

export function deriveCoalitionKeyForParametricIssue(
  issueKey: string,
  issueEconomicScore: number,
): OrdinanceStanceKey | null {
  if (!issueUsesParametricScoring(issueKey)) return null;
  return deriveParametricCoalitionKey(issueEconomicScore);
}

export function buildParametricOrdinanceTitle(
  issueKey: string,
  params: OrdinanceStanceParams,
): string | null {
  if (isMarijuanaIssue(issueKey)) {
    return buildMarijuanaOrdinanceTitle(clampMarijuanaStanceParams(params as MarijuanaStanceParams));
  }
  const bill = getParametricBillDefinition(issueKey);
  if (bill) return bill.buildTitle(params as Record<string, unknown>);
  return null;
}

export function buildParametricOrdinanceSummary(
  issueKey: string,
  params: OrdinanceStanceParams,
): string | null {
  if (isMarijuanaIssue(issueKey)) {
    return buildMarijuanaOrdinanceSummary(clampMarijuanaStanceParams(params as MarijuanaStanceParams));
  }
  const bill = getParametricBillDefinition(issueKey);
  if (bill) return bill.buildSummary(params as Record<string, unknown>);
  return null;
}

export function formatParametricOrdinanceStatus(
  issueKey: string,
  params: Record<string, unknown>,
): string | null {
  const bill = getParametricBillDefinition(issueKey);
  if (bill) return bill.formatStatus(params);
  return null;
}

export function isMarijuanaStanceParams(
  params: OrdinanceStanceParams,
): params is MarijuanaStanceParams {
  return "legal_status" in params;
}

export function isPropertyTaxStanceParams(
  params: OrdinanceStanceParams,
): params is PropertyTaxStanceParams {
  return "rate_delta" in params;
}

export function isRegistryStanceParams(
  issueKey: string,
  params: OrdinanceStanceParams,
): params is RegistryStanceParams {
  return isRegistryParametricIssue(issueKey);
}
