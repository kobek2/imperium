/**
 * Factory for registry parametric ordinance bills.
 */

import type { OrdinanceIssueScores } from "@/lib/city-ordinance-scoring";
import type { PolicyVariableDelta } from "@/lib/city-metrics-engine";
import type { OrdinanceBillParamSchema } from "@/lib/city-ordinance-param-schema";
import type { ParametricBillDefinition } from "@/lib/city-ordinance-param-registry-types";

export function createParametricBill<T extends Record<string, unknown>>(config: {
  issueKey: string;
  schema: OrdinanceBillParamSchema;
  defaults: T;
  clamp: (raw: Partial<T>) => T;
  score: (params: T) => OrdinanceIssueScores;
  policyDeltas: (params: T) => PolicyVariableDelta;
  buildTitle: (params: T) => string;
  buildSummary: (params: T) => string;
  formatStatus: (params: T) => string;
}): ParametricBillDefinition {
  const clampFn = (raw: Partial<Record<string, unknown>>) =>
    config.clamp(raw as Partial<T>) as Record<string, unknown>;

  return {
    issueKey: config.issueKey,
    schema: config.schema,
    defaultParams: { ...config.defaults } as Record<string, unknown>,
    clamp: clampFn,
    score: (raw) => config.score(clampFn(raw) as T),
    policyDeltas: (raw) => config.policyDeltas(clampFn(raw) as T),
    buildTitle: (raw) => config.buildTitle(clampFn(raw) as T),
    buildSummary: (raw) => config.buildSummary(clampFn(raw) as T),
    formatStatus: (raw) => config.formatStatus(clampFn(raw) as T),
  };
}

/** Required JSON keys per issue for SQL / RPC validation. */
export const PARAMETRIC_BILL_REQUIRED_KEYS: Record<string, string[]> = {};

export function registerRequiredKeys(issueKey: string, keys: string[]) {
  PARAMETRIC_BILL_REQUIRED_KEYS[issueKey] = keys;
}

export const ALL_PARAMETRIC_ISSUE_KEYS: string[] = [];

export function trackParametricIssueKey(issueKey: string) {
  if (!ALL_PARAMETRIC_ISSUE_KEYS.includes(issueKey)) {
    ALL_PARAMETRIC_ISSUE_KEYS.push(issueKey);
  }
}
