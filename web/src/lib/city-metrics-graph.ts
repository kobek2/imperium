/**
 * City metrics dependency graph — edit this file to tune causal links.
 * Bills change policy variables; variables and metrics propagate through weighted, delayed edges.
 */

export const CITY_METRIC_KEYS = [
  "education",
  "crime",
  "economy",
  "public_health",
  "housing",
  "public_trust",
  "infrastructure",
  "environment",
] as const;

export type CityMetricKey = (typeof CITY_METRIC_KEYS)[number];

export const CITY_POLICY_VARIABLE_KEYS = [
  "school_funding",
  "police_funding",
  "health_clinic_funding",
  "housing_subsidy",
  "infrastructure_capital",
  "environmental_enforcement",
  "business_regulation",
  "community_programs",
  "tax_burden",
] as const;

export type CityPolicyVariableKey = (typeof CITY_POLICY_VARIABLE_KEYS)[number];

export type GraphNodeKind = "variable" | "metric";

export type EffectDelayTier = "immediate" | "short" | "long";

export const EFFECT_DELAY_TICKS: Record<EffectDelayTier, number> = {
  immediate: 0,
  short: 2,
  long: 6,
};

export type CityMetricsGraphEdge = {
  from: { kind: GraphNodeKind; key: string };
  to: { kind: GraphNodeKind; key: string };
  /** Multiplier on source delta before direction. */
  weight: number;
  /** +1 = positive correlation, -1 = inverse. */
  direction: 1 | -1;
  delay: EffectDelayTier;
  /** Groups diminishing-returns pressure (defaults to target metric). */
  policyTag?: string;
};

export type CityShockEventDef = {
  id: string;
  title: string;
  summary: string;
  /** Per-tick probability (0–1) when no cooldown active. */
  probabilityPerTick: number;
  cooldownTicks: number;
  effects: {
    target: { kind: GraphNodeKind; key: string };
    magnitude: number;
    delay: EffectDelayTier;
    policyTag?: string;
  }[];
};

export const CITY_METRIC_LABELS: Record<CityMetricKey, string> = {
  education: "Education",
  crime: "Public safety",
  economy: "Economic health (derived)",
  public_health: "Public health",
  housing: "Housing & cost of living",
  public_trust: "Public trust",
  infrastructure: "Infrastructure",
  environment: "Environment",
};

export const CITY_POLICY_VARIABLE_LABELS: Record<CityPolicyVariableKey, string> = {
  school_funding: "School funding",
  police_funding: "Police staffing budget",
  health_clinic_funding: "Health clinic funding",
  housing_subsidy: "Affordable housing programs",
  infrastructure_capital: "Infrastructure capital",
  environmental_enforcement: "Environmental enforcement",
  business_regulation: "Business regulation",
  community_programs: "Community safety programs",
  tax_burden: "Tax burden",
};

/** Maps engine metrics to legacy `city_fiscal_metrics` columns for fiscal UI compatibility. */
export const LEGACY_FISCAL_METRIC_MAP: Record<
  CityMetricKey,
  | "education_quality"
  | "public_safety"
  | "economy_index"
  | "housing_affordability"
  | "mayor_approval"
  | null
> = {
  education: "education_quality",
  crime: "public_safety",
  economy: "economy_index",
  public_health: null,
  housing: "housing_affordability",
  public_trust: "mayor_approval",
  infrastructure: null,
  environment: null,
};

export const CITY_METRICS_DEFAULTS: Record<CityMetricKey, number> = {
  education: 46,
  crime: 48,
  economy: 51,
  public_health: 50,
  housing: 42,
  public_trust: 54,
  infrastructure: 47,
  environment: 49,
};

export const CITY_POLICY_VARIABLE_DEFAULTS: Record<CityPolicyVariableKey, number> = {
  school_funding: 50,
  police_funding: 52,
  health_clinic_funding: 48,
  housing_subsidy: 45,
  infrastructure_capital: 50,
  environmental_enforcement: 47,
  business_regulation: 50,
  community_programs: 48,
  tax_burden: 50,
};

/**
 * Full interdependency graph.
 * Variables → metrics (short/long delays) and metrics → metrics (feedback loops).
 */
export const CITY_METRICS_GRAPH_EDGES: CityMetricsGraphEdge[] = [
  // —— Policy variables → metrics ——
  { from: { kind: "variable", key: "school_funding" }, to: { kind: "metric", key: "education" }, weight: 0.14, direction: 1, delay: "short", policyTag: "education_funding" },
  { from: { kind: "variable", key: "school_funding" }, to: { kind: "metric", key: "economy" }, weight: 0.05, direction: 1, delay: "long", policyTag: "education_funding" },

  { from: { kind: "variable", key: "police_funding" }, to: { kind: "metric", key: "crime" }, weight: 0.12, direction: 1, delay: "short", policyTag: "policing" },
  { from: { kind: "variable", key: "police_funding" }, to: { kind: "metric", key: "public_trust" }, weight: 0.04, direction: 1, delay: "short", policyTag: "policing" },

  { from: { kind: "variable", key: "community_programs" }, to: { kind: "metric", key: "crime" }, weight: 0.09, direction: 1, delay: "short", policyTag: "community_policing" },
  { from: { kind: "variable", key: "community_programs" }, to: { kind: "metric", key: "public_trust" }, weight: 0.07, direction: 1, delay: "short", policyTag: "community_policing" },
  { from: { kind: "variable", key: "community_programs" }, to: { kind: "metric", key: "education" }, weight: 0.04, direction: 1, delay: "long", policyTag: "community_policing" },

  { from: { kind: "variable", key: "health_clinic_funding" }, to: { kind: "metric", key: "public_health" }, weight: 0.13, direction: 1, delay: "short", policyTag: "health_funding" },
  { from: { kind: "variable", key: "health_clinic_funding" }, to: { kind: "metric", key: "public_trust" }, weight: 0.03, direction: 1, delay: "short", policyTag: "health_funding" },

  { from: { kind: "variable", key: "housing_subsidy" }, to: { kind: "metric", key: "housing" }, weight: 0.11, direction: 1, delay: "short", policyTag: "housing_policy" },
  { from: { kind: "variable", key: "housing_subsidy" }, to: { kind: "metric", key: "economy" }, weight: 0.03, direction: -1, delay: "long", policyTag: "housing_policy" },

  { from: { kind: "variable", key: "infrastructure_capital" }, to: { kind: "metric", key: "infrastructure" }, weight: 0.12, direction: 1, delay: "short", policyTag: "infrastructure" },
  { from: { kind: "variable", key: "infrastructure_capital" }, to: { kind: "metric", key: "economy" }, weight: 0.06, direction: 1, delay: "long", policyTag: "infrastructure" },
  { from: { kind: "variable", key: "infrastructure_capital" }, to: { kind: "metric", key: "housing" }, weight: 0.04, direction: 1, delay: "long", policyTag: "infrastructure" },

  { from: { kind: "variable", key: "environmental_enforcement" }, to: { kind: "metric", key: "environment" }, weight: 0.12, direction: 1, delay: "short", policyTag: "environment" },
  { from: { kind: "variable", key: "environmental_enforcement" }, to: { kind: "metric", key: "economy" }, weight: 0.05, direction: -1, delay: "long", policyTag: "environment" },

  { from: { kind: "variable", key: "business_regulation" }, to: { kind: "metric", key: "economy" }, weight: 0.08, direction: -1, delay: "short", policyTag: "business_regulation" },
  { from: { kind: "variable", key: "business_regulation" }, to: { kind: "metric", key: "environment" }, weight: 0.05, direction: 1, delay: "long", policyTag: "business_regulation" },

  { from: { kind: "variable", key: "tax_burden" }, to: { kind: "metric", key: "housing" }, weight: 0.06, direction: -1, delay: "short", policyTag: "tax_policy" },
  { from: { kind: "variable", key: "tax_burden" }, to: { kind: "metric", key: "public_trust" }, weight: 0.05, direction: -1, delay: "short", policyTag: "tax_policy" },
  { from: { kind: "variable", key: "tax_burden" }, to: { kind: "metric", key: "infrastructure" }, weight: 0.04, direction: 1, delay: "long", policyTag: "tax_policy" },

  // —— Metric → metric feedback ——
  { from: { kind: "metric", key: "education" }, to: { kind: "metric", key: "crime" }, weight: 0.06, direction: 1, delay: "long" },
  { from: { kind: "metric", key: "education" }, to: { kind: "metric", key: "economy" }, weight: 0.08, direction: 1, delay: "long" },

  { from: { kind: "metric", key: "crime" }, to: { kind: "metric", key: "public_trust" }, weight: 0.09, direction: 1, delay: "short" },
  { from: { kind: "metric", key: "crime" }, to: { kind: "metric", key: "economy" }, weight: 0.07, direction: 1, delay: "long" },

  { from: { kind: "metric", key: "economy" }, to: { kind: "metric", key: "housing" }, weight: 0.06, direction: -1, delay: "long" },
  { from: { kind: "metric", key: "economy" }, to: { kind: "metric", key: "public_trust" }, weight: 0.05, direction: 1, delay: "short" },

  { from: { kind: "metric", key: "public_health" }, to: { kind: "metric", key: "economy" }, weight: 0.05, direction: 1, delay: "long" },
  { from: { kind: "metric", key: "public_health" }, to: { kind: "metric", key: "public_trust" }, weight: 0.05, direction: 1, delay: "short" },

  { from: { kind: "metric", key: "infrastructure" }, to: { kind: "metric", key: "economy" }, weight: 0.07, direction: 1, delay: "long" },
  { from: { kind: "metric", key: "infrastructure" }, to: { kind: "metric", key: "housing" }, weight: 0.04, direction: 1, delay: "long" },

  { from: { kind: "metric", key: "environment" }, to: { kind: "metric", key: "public_health" }, weight: 0.06, direction: 1, delay: "long" },
  { from: { kind: "metric", key: "environment" }, to: { kind: "metric", key: "public_trust" }, weight: 0.04, direction: 1, delay: "short" },
];

export const CITY_SHOCK_EVENTS: CityShockEventDef[] = [
  {
    id: "regional_recession",
    title: "Regional recession",
    summary: "A downturn in the metro economy ripples through city revenue and hiring.",
    probabilityPerTick: 0.04,
    cooldownTicks: 8,
    effects: [
      { target: { kind: "metric", key: "economy" }, magnitude: -7, delay: "short" },
      { target: { kind: "metric", key: "public_trust" }, magnitude: -4, delay: "short" },
      { target: { kind: "metric", key: "housing" }, magnitude: -3, delay: "long" },
    ],
  },
  {
    id: "corruption_scandal",
    title: "Corruption scandal",
    summary: "A contracting scandal dominates headlines and erodes confidence in city hall.",
    probabilityPerTick: 0.025,
    cooldownTicks: 12,
    effects: [{ target: { kind: "metric", key: "public_trust" }, magnitude: -11, delay: "immediate" }],
  },
  {
    id: "neighbor_city_crisis",
    title: "Neighboring city crisis",
    summary: "An influx from a neighboring jurisdiction strains clinics and patrol coverage.",
    probabilityPerTick: 0.03,
    cooldownTicks: 10,
    effects: [
      { target: { kind: "metric", key: "public_health" }, magnitude: -6, delay: "short" },
      { target: { kind: "metric", key: "crime" }, magnitude: -5, delay: "short" },
    ],
  },
  {
    id: "heat_wave",
    title: "Severe heat wave",
    summary: "Record temperatures stress health systems and air quality.",
    probabilityPerTick: 0.035,
    cooldownTicks: 6,
    effects: [
      { target: { kind: "metric", key: "public_health" }, magnitude: -5, delay: "immediate" },
      { target: { kind: "metric", key: "environment" }, magnitude: -4, delay: "short" },
    ],
  },
  {
    id: "tech_boom",
    title: "Tech sector expansion",
    summary: "New employers announce headquarters moves into the city.",
    probabilityPerTick: 0.03,
    cooldownTicks: 10,
    effects: [
      { target: { kind: "metric", key: "economy" }, magnitude: 6, delay: "short" },
      { target: { kind: "metric", key: "housing" }, magnitude: -5, delay: "long" },
    ],
  },
];

export function edgesFromSource(kind: GraphNodeKind, key: string): CityMetricsGraphEdge[] {
  return CITY_METRICS_GRAPH_EDGES.filter((e) => e.from.kind === kind && e.from.key === key);
}
