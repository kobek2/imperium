/**
 * Multi-parameter city ordinance bills — reusable shape for future categories.
 *
 * Each bill type is a list of parameters. Each parameter is one of:
 * - ordinal: stepped control (discrete stops, not a free slider)
 * - boolean: toggle
 * - continuous: numeric slider (min/max)
 *
 * Optional `visibleWhen` / `enabledWhen` rules reference sibling parameters
 * in the same bill (progressive disclosure in the UI).
 *
 * Scoring: each bill provides a pure `score(params) → { issue_economic_score, issue_social_score }`
 * with the same contract as property tax. `_npc_ideology_vote` consumes only those scores.
 *
 * Worked example: marijuana_legalization (see marijuana-ordinance-scoring.ts + form component).
 * Property tax remains the single-axis reference implementation — do not modify it here.
 */

export type OrdinanceParamKind = "ordinal" | "boolean" | "continuous";

export type OrdinanceParamVisibilityRule = {
  /** Parameter key in the same bill. */
  param: string;
  /** Ordinal step index >= this (0-based). */
  ordinalGte?: number;
  /** Boolean must equal this value. */
  equals?: boolean;
  /** Continuous value > this. */
  continuousGt?: number;
  /** Continuous value >= this. */
  continuousGte?: number;
  /** Continuous value < this. */
  continuousLt?: number;
  /** Continuous value <= this. */
  continuousLte?: number;
};

export type OrdinanceOrdinalStep = {
  value: string;
  label: string;
};

export type OrdinanceParamDefinition = {
  key: string;
  kind: OrdinanceParamKind;
  label: string;
  description?: string;
  ordinalSteps?: OrdinanceOrdinalStep[];
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  visibleWhen?: OrdinanceParamVisibilityRule[];
};

export type OrdinanceBillParamSchema = {
  issueKey: string;
  label: string;
  parameters: OrdinanceParamDefinition[];
};

export function paramRuleSatisfied(
  params: Record<string, unknown>,
  rules: OrdinanceParamVisibilityRule[] | undefined,
  ordinalIndex: (value: string, steps: OrdinanceOrdinalStep[]) => number,
  ordinalStepsByKey: Record<string, OrdinanceOrdinalStep[]>,
): boolean {
  if (!rules?.length) return true;
  return rules.every((rule) => {
    const raw = params[rule.param];
    if (rule.equals !== undefined) return raw === rule.equals;
    if (rule.continuousGt !== undefined) return Number(raw ?? 0) > rule.continuousGt;
    if (rule.continuousGte !== undefined) return Number(raw ?? 0) >= rule.continuousGte;
    if (rule.continuousLt !== undefined) return Number(raw ?? 0) < rule.continuousLt;
    if (rule.continuousLte !== undefined) return Number(raw ?? 0) <= rule.continuousLte;
    if (rule.ordinalGte !== undefined) {
      const steps = ordinalStepsByKey[rule.param];
      if (!steps) return false;
      const idx = ordinalIndex(String(raw ?? ""), steps);
      return idx >= rule.ordinalGte;
    }
    return true;
  });
}

export function ordinalStepIndex(value: string, steps: OrdinanceOrdinalStep[]): number {
  const i = steps.findIndex((s) => s.value === value);
  return i >= 0 ? i : 0;
}
