/**
 * Registry for parametric ordinance bills (excluding property tax + marijuana).
 */

import type { ParametricBillDefinition } from "@/lib/city-ordinance-param-registry-types";
import { EXPANSION_PARAMETRIC_BILLS } from "@/lib/parametric-ordinance-bills";
import {
  buildPolicingOrdinanceSummary,
  buildPolicingOrdinanceTitle,
  clampPolicingStanceParams,
  DEFAULT_POLICING_STANCE_PARAMS,
  formatPolicingPolicyStatus,
  isPolicingIssue,
  POLICING_BILL_SCHEMA,
  policingParamsToPolicyDeltas,
  POLICING_ISSUE_KEY,
  scorePolicingOrdinance,
  type PolicingStanceParams,
} from "@/lib/policing-community-programs-scoring";
import { registerRequiredKeys, trackParametricIssueKey } from "@/lib/parametric-bill-factory";

export type { ParametricBillDefinition } from "@/lib/city-ordinance-param-registry-types";

const POLICING_DEFINITION: ParametricBillDefinition = {
  issueKey: POLICING_ISSUE_KEY,
  schema: POLICING_BILL_SCHEMA,
  defaultParams: { ...DEFAULT_POLICING_STANCE_PARAMS },
  clamp: (raw) => clampPolicingStanceParams(raw as Partial<PolicingStanceParams>) as Record<string, unknown>,
  score: (raw) => scorePolicingOrdinance(clampPolicingStanceParams(raw as Partial<PolicingStanceParams>)),
  policyDeltas: (raw) =>
    policingParamsToPolicyDeltas(clampPolicingStanceParams(raw as Partial<PolicingStanceParams>)),
  buildTitle: (raw) =>
    buildPolicingOrdinanceTitle(clampPolicingStanceParams(raw as Partial<PolicingStanceParams>)),
  buildSummary: (raw) =>
    buildPolicingOrdinanceSummary(clampPolicingStanceParams(raw as Partial<PolicingStanceParams>)),
  formatStatus: (raw) =>
    formatPolicingPolicyStatus(raw as Partial<PolicingStanceParams>),
};

const ALL_BILLS: ParametricBillDefinition[] = [POLICING_DEFINITION, ...EXPANSION_PARAMETRIC_BILLS];

trackParametricIssueKey(POLICING_ISSUE_KEY);
registerRequiredKeys(POLICING_ISSUE_KEY, POLICING_BILL_SCHEMA.parameters.map((p) => p.key));

const REGISTRY = new Map<string, ParametricBillDefinition>(
  ALL_BILLS.map((bill) => [bill.issueKey, bill]),
);

export function getParametricBillDefinition(issueKey: string): ParametricBillDefinition | undefined {
  return REGISTRY.get(issueKey.toLowerCase().trim());
}

export function isRegistryParametricIssue(issueKey: string): boolean {
  return REGISTRY.has(issueKey.toLowerCase().trim());
}

export function listRegistryParametricIssueKeys(): string[] {
  return [...REGISTRY.keys()];
}

export function allParametricBillDefinitions(): ParametricBillDefinition[] {
  return ALL_BILLS;
}

export { isPolicingIssue };
