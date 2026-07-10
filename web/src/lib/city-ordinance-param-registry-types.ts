import type { OrdinanceIssueScores } from "@/lib/city-ordinance-scoring";
import type { PolicyVariableDelta } from "@/lib/city-metrics-engine";
import type { OrdinanceBillParamSchema } from "@/lib/city-ordinance-param-schema";

export type ParametricBillDefinition = {
  issueKey: string;
  schema: OrdinanceBillParamSchema;
  defaultParams: Record<string, unknown>;
  clamp: (raw: Partial<Record<string, unknown>>) => Record<string, unknown>;
  score: (params: Record<string, unknown>) => OrdinanceIssueScores;
  policyDeltas: (params: Record<string, unknown>) => PolicyVariableDelta;
  buildTitle: (params: Record<string, unknown>) => string;
  buildSummary: (params: Record<string, unknown>) => string;
  formatStatus: (params: Record<string, unknown>) => string;
};
