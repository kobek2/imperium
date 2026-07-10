import type { SupabaseClient } from "@supabase/supabase-js";
import { NYC_CITY_CODE } from "@/lib/city";
import { computeCityFiscalTotals, departmentMinimumMillions, loadCityFiscalSnapshot, type CityFiscalSnapshot } from "@/lib/city-fiscal-data";
import { economicFiscalContextFromSnapshot } from "@/lib/city-economic-indicator";
import type { CityEconomicFiscalContext } from "@/lib/city-economic-indicator";
import { refreshCityBusinessTaxRevenue } from "@/lib/city-player-business-activity-data";
import {
  buildDepartmentFundingStates,
  departmentFundingApprovalModifier,
  detectDepartmentUnderperformance,
  type DepartmentUnderperformanceEvent,
} from "@/lib/city-department-effectiveness";
import { computeMayoralElectoralApproval } from "@/lib/city-mayoral-electoral-approval";
import { WARD_POPULATION_SHARE } from "@/lib/city-mayoral-electoral-approval";
import { loadCityApprovalContext } from "@/lib/city-ward-election-data";
import {
  CITY_METRICS_DEFAULTS,
  CITY_METRIC_KEYS,
  LEGACY_FISCAL_METRIC_MAP,
  type CityMetricKey,
} from "@/lib/city-metrics-graph";
import {
  computeApprovalRating,
  enrichHistoryPoint,
  processPresentationAfterTicks,
  type ApprovalTier,
  type DepartmentPresentationEvent,
  type EnrichedCityMetricHistoryPoint,
} from "@/lib/city-metrics-presentation";
import {
  createInitialEngineState,
  parseEngineState,
  processCityMetricsTicks,
  serializeEngineState,
  enqueuePolicyVariableChanges,
  type CityMetricHistoryPoint,
  type CityMetricsEngineState,
  type PolicyVariableDelta,
} from "@/lib/city-metrics-engine";

export type CityPresentationMeta = {
  approvalTier: ApprovalTier;
  cooperationBonus: number;
  primaryChallengerSurfaced: boolean;
  mayorElectoralApproval?: number | null;
  departmentFundingModifier?: number;
};

type ApprovalLayerContext = {
  mayorElectoralApproval: number;
  departmentFundingModifier: number;
  departmentEvents: DepartmentPresentationEvent[];
};

export type CityMetricsSnapshot = {
  state: CityMetricsEngineState;
  history: EnrichedCityMetricHistoryPoint[];
  fiscalYear: number;
  simYear: number;
  simWeek: number;
  updatedAt: string;
  presentationMeta: CityPresentationMeta;
};

function fiscalContextFromSnapshot(fiscal?: CityFiscalSnapshot): CityEconomicFiscalContext | undefined {
  if (!fiscal || fiscal.population <= 0) return undefined;
  return economicFiscalContextFromSnapshot({
    population: fiscal.population,
    businessTaxRevenueMillions: fiscal.businessTaxRevenueMillions,
    officeSalaryPoolMillions: fiscal.officeSalaryPoolMillions,
  });
}

async function refreshCityEconomicPipeline(
  supabase: SupabaseClient,
  cityCode: string = NYC_CITY_CODE,
): Promise<void> {
  await supabase.rpc("refresh_city_office_salary_accruals", { p_city_code: cityCode });
  await refreshCityBusinessTaxRevenue(supabase, cityCode);
}

function metricsFromFiscal(fiscal: CityFiscalSnapshot): Partial<Record<CityMetricKey, number>> {
  const out: Partial<Record<CityMetricKey, number>> = { ...CITY_METRICS_DEFAULTS };
  for (const key of CITY_METRIC_KEYS) {
    const legacy = LEGACY_FISCAL_METRIC_MAP[key];
    if (!legacy) continue;
    const value = fiscal[legacy as keyof CityFiscalSnapshot];
    if (typeof value === "number") out[key] = value;
  }
  return out;
}

function priorMetricsFromHistory(history: EnrichedCityMetricHistoryPoint[]): Record<CityMetricKey, number> {
  const last = history[history.length - 1];
  return last?.metrics ?? { ...CITY_METRICS_DEFAULTS };
}

function priorApprovalFromHistory(history: EnrichedCityMetricHistoryPoint[]): number {
  const last = history[history.length - 1];
  return last?.approvalRating ?? computeApprovalRating(priorMetricsFromHistory(history));
}

function parsePresentationMeta(raw: Record<string, unknown> | undefined): CityPresentationMeta {
  const meta = raw ?? {};
  return {
    approvalTier: (meta.approval_tier as ApprovalTier) ?? "stable",
    cooperationBonus: Number(meta.cooperation_bonus ?? 0),
    primaryChallengerSurfaced: Boolean(meta.primary_challenger_surfaced),
    mayorElectoralApproval:
      meta.mayor_electoral_approval != null ? Number(meta.mayor_electoral_approval) : null,
    departmentFundingModifier:
      meta.department_funding_modifier != null ? Number(meta.department_funding_modifier) : undefined,
  };
}

async function buildApprovalLayerContext(
  supabase: SupabaseClient,
  fiscal: CityFiscalSnapshot,
  simTick: number,
  rawHistory: CityMetricHistoryPoint[],
  priorMetrics: Record<CityMetricKey, number>,
  recomputeElectoral: boolean,
): Promise<ApprovalLayerContext> {
  if (recomputeElectoral) {
    await supabase.rpc("recompute_mayor_electoral_approval", { p_city_code: NYC_CITY_CODE });
    fiscal = await loadCityFiscalSnapshot(supabase, NYC_CITY_CODE);
  }

  const approvalCtx = await loadCityApprovalContext(supabase, {
    simTick,
    cityPopulation: fiscal.population,
    mayorElectoralApproval: fiscal.mayorElectoralApproval,
  });

  const mayorElectoralApproval =
    fiscal.mayorElectoralApproval > 0
      ? fiscal.mayorElectoralApproval
      : computeMayoralElectoralApproval(approvalCtx.wardElectoral, fiscal.population);

  const fiscalTotals = computeCityFiscalTotals(fiscal);
  const allocations = fiscal.departments.map((d) => ({
    departmentKey: d.departmentKey,
    amountMillions: d.amountMillions,
    minimumMillions:
      d.minimumRequiredMillions && d.minimumRequiredMillions > 0
        ? d.minimumRequiredMillions
        : departmentMinimumMillions(
            d.departmentKey,
            fiscal,
            fiscalTotals.totalRevenueMillions,
            fiscalTotals.revenueSource,
          ),
  }));

  const fundingStates = buildDepartmentFundingStates(
    allocations,
    approvalCtx.wardPriorities,
    WARD_POPULATION_SHARE,
  );
  const departmentFundingModifier = departmentFundingApprovalModifier(fundingStates);

  const departmentEvents: DepartmentPresentationEvent[] = [];
  let before = priorMetrics;
  for (const point of rawHistory) {
    const detected: DepartmentUnderperformanceEvent[] = detectDepartmentUnderperformance({
      tick: point.tick,
      before,
      after: point.metrics,
      fundingStates,
    });
    for (const ev of detected) {
      departmentEvents.push({
        departmentKey: ev.departmentKey,
        metric: ev.metric,
        tick: ev.tick,
        headline: ev.headline,
        body: ev.body,
      });
    }
    before = point.metrics;
  }

  return { mayorElectoralApproval, departmentFundingModifier, departmentEvents };
}

function parseHistoryRows(
  rows: {
    sim_tick: number;
    metrics: Record<string, number>;
    approval_rating?: number | null;
    recorded_at: string;
  }[],
): EnrichedCityMetricHistoryPoint[] {
  return rows.map((r) => {
    const metrics = { ...CITY_METRICS_DEFAULTS, ...(r.metrics as Partial<Record<CityMetricKey, number>>) };
    return enrichHistoryPoint(
      {
        tick: Number(r.sim_tick),
        metrics,
        recordedAt: r.recorded_at,
      },
      r.approval_rating != null ? Number(r.approval_rating) : undefined,
    );
  });
}

function simWeekFromEngine(engineState?: Record<string, unknown> | null): {
  simYear: number;
  simWeek: number;
} {
  return {
    simYear: Number(engineState?.sim_year ?? 1),
    simWeek: Number(engineState?.sim_week ?? 1),
  };
}

function emptySnapshot(cityCode: string = NYC_CITY_CODE): CityMetricsSnapshot {
  const state = createInitialEngineState({ cityCode });
  const history = [
    enrichHistoryPoint({
      tick: 0,
      metrics: { ...state.metrics },
      recordedAt: new Date().toISOString(),
    }),
  ];
  return {
    state,
    history,
    fiscalYear: 1,
    simYear: 1,
    simWeek: 1,
    updatedAt: new Date(0).toISOString(),
    presentationMeta: {
      approvalTier: "stable",
      cooperationBonus: 0,
      primaryChallengerSurfaced: false,
    },
  };
}

async function persistCityMetricsSnapshot(
  supabase: SupabaseClient,
  snapshot: CityMetricsSnapshot,
  presentationEvents?: {
    narratives: { headline: string; body: string; metric: string; tier: string; tick: number }[];
    departmentEvents: DepartmentPresentationEvent[];
    lowApprovalBriefing: string | null;
    primaryChallenger: boolean;
  },
): Promise<{ ok: boolean; error?: string }> {
  const presentationMeta = {
    approval_tier: snapshot.presentationMeta.approvalTier,
    cooperation_bonus: snapshot.presentationMeta.cooperationBonus,
    primary_challenger_surfaced:
      snapshot.presentationMeta.primaryChallengerSurfaced ||
      Boolean(presentationEvents?.primaryChallenger),
    mayor_electoral_approval: snapshot.presentationMeta.mayorElectoralApproval ?? null,
    department_funding_modifier: snapshot.presentationMeta.departmentFundingModifier ?? 0,
  };

  const { error } = await supabase.rpc("save_city_metrics_snapshot", {
    p_city_code: snapshot.state.cityCode,
    p_engine_state: serializeEngineState(snapshot.state),
    p_history_append: snapshot.history.map((h) => ({
      sim_tick: h.tick,
      metrics: h.metrics,
      approval_rating: h.approvalRating,
      recorded_at: h.recordedAt,
    })),
    p_sync_fiscal: true,
    p_presentation_meta: presentationMeta,
    p_presentation_events: presentationEvents
      ? {
          narratives: presentationEvents.narratives,
          department_events: presentationEvents.departmentEvents,
          low_approval_briefing: presentationEvents.lowApprovalBriefing,
          primary_challenger: presentationEvents.primaryChallenger,
        }
      : null,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

function applyPresentationLayer(
  loaded: CityMetricsSnapshot,
  rawHistory: CityMetricHistoryPoint[],
  approvalLayer: ApprovalLayerContext,
  policyName?: string,
): {
  history: EnrichedCityMetricHistoryPoint[];
  presentationMeta: CityPresentationMeta;
  presentationEvents: {
    narratives: { headline: string; body: string; metric: string; tier: string; tick: number }[];
    departmentEvents: DepartmentPresentationEvent[];
    lowApprovalBriefing: string | null;
    primaryChallenger: boolean;
  } | null;
} {
  if (!rawHistory.length) {
    return { history: [], presentationMeta: loaded.presentationMeta, presentationEvents: null };
  }

  const outcome = processPresentationAfterTicks({
    priorMetrics: priorMetricsFromHistory(loaded.history),
    priorApproval: priorApprovalFromHistory(loaded.history),
    newHistory: rawHistory,
    policyName,
    seed: loaded.state.seed,
    challengerAlreadySurfaced: loaded.presentationMeta.primaryChallengerSurfaced,
    mayorElectoralApproval: approvalLayer.mayorElectoralApproval,
    departmentFundingModifier: approvalLayer.departmentFundingModifier,
    departmentEvents: approvalLayer.departmentEvents,
  });

  return {
    history: outcome.enrichedHistory,
    presentationMeta: {
      approvalTier: outcome.approvalTier,
      cooperationBonus: outcome.cooperationBonus,
      primaryChallengerSurfaced:
        loaded.presentationMeta.primaryChallengerSurfaced || outcome.primaryChallengerSurfaced,
      mayorElectoralApproval: approvalLayer.mayorElectoralApproval,
      departmentFundingModifier: approvalLayer.departmentFundingModifier,
    },
    presentationEvents:
      outcome.narrativeEvents.length ||
      outcome.departmentEvents.length ||
      outcome.lowApprovalBriefing ||
      outcome.primaryChallengerSurfaced
        ? {
            narratives: outcome.narrativeEvents.map((e) => ({
              headline: e.headline,
              body: e.body,
              metric: e.metric,
              tier: e.tier,
              tick: e.tick,
            })),
            departmentEvents: outcome.departmentEvents,
            lowApprovalBriefing: outcome.lowApprovalBriefing,
            primaryChallenger: outcome.primaryChallengerSurfaced,
          }
        : null,
  };
}

export async function ensureCityMetricsCaughtUp(
  supabase: SupabaseClient,
  cityCode: string = NYC_CITY_CODE,
  fiscal?: CityFiscalSnapshot,
): Promise<CityMetricsSnapshot> {
  return loadCityMetricsSnapshot(supabase, cityCode, fiscal);
}

export async function loadCityMetricsSnapshot(
  supabase: SupabaseClient,
  cityCode: string = NYC_CITY_CODE,
  fiscal?: CityFiscalSnapshot,
): Promise<CityMetricsSnapshot> {
  const { data, error } = await supabase.rpc("get_city_metrics_snapshot", {
    p_city_code: cityCode,
  });

  if (error) {
    console.warn("[city-metrics-data] snapshot:", error.message);
    if (fiscal) {
      const state = createInitialEngineState({
        cityCode,
        metrics: metricsFromFiscal(fiscal),
      });
      const history = [
        enrichHistoryPoint({
          tick: 0,
          metrics: { ...state.metrics },
          recordedAt: fiscal.updatedAt,
        }),
      ];
      return {
        state,
        history,
        fiscalYear: fiscal.fiscalYear,
        ...simWeekFromEngine(),
        updatedAt: fiscal.updatedAt,
        presentationMeta: {
          approvalTier: "stable",
          cooperationBonus: 0,
          primaryChallengerSurfaced: false,
        },
      };
    }
    return emptySnapshot(cityCode);
  }

  const raw = data as {
    engine_state?: Record<string, unknown> | null;
    history?: {
      sim_tick: number;
      metrics: Record<string, number>;
      approval_rating?: number | null;
      recorded_at: string;
    }[];
    fiscal_year?: number;
    updated_at?: string;
  };

  if (!raw.engine_state) {
    const state = createInitialEngineState({
      cityCode,
      metrics: fiscal ? metricsFromFiscal(fiscal) : undefined,
    });
    const history = [
      enrichHistoryPoint({
        tick: 0,
        metrics: { ...state.metrics },
        recordedAt: new Date().toISOString(),
      }),
    ];
    return {
      state,
      history,
      fiscalYear: fiscal?.fiscalYear ?? 1,
      ...simWeekFromEngine(),
      updatedAt: fiscal?.updatedAt ?? new Date().toISOString(),
      presentationMeta: {
        approvalTier: "stable",
        cooperationBonus: 0,
        primaryChallengerSurfaced: false,
      },
    };
  }

  const engineState = raw.engine_state;
  const weekFields = simWeekFromEngine(engineState);
  return {
    state: parseEngineState(engineState),
    history: parseHistoryRows(raw.history ?? []),
    fiscalYear: Number(raw.fiscal_year ?? fiscal?.fiscalYear ?? 1),
    ...weekFields,
    updatedAt: String(raw.updated_at ?? new Date().toISOString()),
    presentationMeta: parsePresentationMeta(
      engineState.presentation_meta as Record<string, unknown> | undefined,
    ),
  };
}

/** Apply policy variable changes and run one propagation tick. */
export async function applyCityPolicyAndTick(
  supabase: SupabaseClient,
  input: {
    cityCode?: string;
    policyDeltas: PolicyVariableDelta;
    sourceLabel: string;
    tickCount?: number;
    fiscal?: CityFiscalSnapshot;
  },
): Promise<{ ok: boolean; snapshot?: CityMetricsSnapshot; error?: string }> {
  const cityCode = input.cityCode ?? NYC_CITY_CODE;
  await refreshCityEconomicPipeline(supabase, cityCode);
  const loaded = await loadCityMetricsSnapshot(supabase, cityCode, input.fiscal);
  const freshFiscal = input.fiscal ?? (await loadCityFiscalSnapshot(supabase, NYC_CITY_CODE));
  const fiscalCtx = fiscalContextFromSnapshot(freshFiscal);

  const stateWithPolicy = enqueuePolicyVariableChanges(loaded.state, input.policyDeltas, input.sourceLabel);
  const tickCount = input.tickCount ?? 1;
  const { state: afterTicks, history: rawHistory } = processCityMetricsTicks(
    stateWithPolicy,
    tickCount,
    fiscalCtx,
  );
  const recomputeElectoral = input.sourceLabel.startsWith("budget:");
  const approvalLayer = await buildApprovalLayerContext(
    supabase,
    freshFiscal,
    afterTicks.tick,
    rawHistory,
    priorMetricsFromHistory(loaded.history),
    recomputeElectoral,
  );
  const { history, presentationMeta, presentationEvents } = applyPresentationLayer(
    loaded,
    rawHistory,
    approvalLayer,
    input.sourceLabel,
  );

  const snapshot: CityMetricsSnapshot = {
    state: afterTicks,
    history,
    fiscalYear: loaded.fiscalYear,
    simYear: loaded.simYear,
    simWeek: loaded.simWeek,
    updatedAt: new Date().toISOString(),
    presentationMeta,
  };

  const saved = await persistCityMetricsSnapshot(supabase, snapshot, presentationEvents ?? undefined);
  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, snapshot: { ...snapshot, history: [...loaded.history, ...history] } };
}

/** Advance sim ticks without new policy (admin week hook). */
export async function advanceCityMetricsTicks(
  supabase: SupabaseClient,
  tickCount = 1,
  cityCode = NYC_CITY_CODE,
  opts?: { skipEconomicRefresh?: boolean },
): Promise<{ ok: boolean; snapshot?: CityMetricsSnapshot; error?: string }> {
  const loaded = await loadCityMetricsSnapshot(supabase, cityCode);
  if (!opts?.skipEconomicRefresh) {
    await refreshCityEconomicPipeline(supabase, cityCode);
  }
  const freshFiscal = await loadCityFiscalSnapshot(supabase, cityCode);
  const fiscalCtx = fiscalContextFromSnapshot(freshFiscal);

  const { state, history: rawHistory } = processCityMetricsTicks(loaded.state, tickCount, fiscalCtx);
  const approvalLayer = await buildApprovalLayerContext(
    supabase,
    freshFiscal,
    state.tick,
    rawHistory,
    priorMetricsFromHistory(loaded.history),
    false,
  );
  const { history, presentationMeta, presentationEvents } = applyPresentationLayer(
    loaded,
    rawHistory,
    approvalLayer,
    "sim week",
  );

  const snapshot: CityMetricsSnapshot = {
    state,
    history,
    fiscalYear: loaded.fiscalYear,
    simYear: loaded.simYear,
    simWeek: loaded.simWeek,
    updatedAt: new Date().toISOString(),
    presentationMeta,
  };

  const saved = await persistCityMetricsSnapshot(supabase, snapshot, presentationEvents ?? undefined);
  if (!saved.ok) return { ok: false, error: saved.error };

  return {
    ok: true,
    snapshot: { ...snapshot, history: [...loaded.history, ...history] },
  };
}

/** Single-tick preview without persistence (UI). */
export function previewPolicyEffects(
  state: CityMetricsEngineState,
  policyDeltas: PolicyVariableDelta,
  tickCount = 3,
  fiscalContext?: CityEconomicFiscalContext,
): { state: CityMetricsEngineState; history: EnrichedCityMetricHistoryPoint[] } {
  const ctx =
    fiscalContext ??
    ({
      population: 8_336_817,
      businessTaxRevenueMillions: 12,
      salaryPoolMillions: 0.5,
    } satisfies CityEconomicFiscalContext);
  const withPolicy = enqueuePolicyVariableChanges(state, policyDeltas, "preview");
  const { state: after, history: raw } = processCityMetricsTicks(withPolicy, tickCount, ctx);
  const enriched = raw.map((point) =>
    enrichHistoryPoint(point, computeApprovalRating(point.metrics)),
  );
  return { state: after, history: enriched };
}

export { processCityMetricsTick } from "@/lib/city-metrics-engine";
