/**
 * Deterministic city metrics tick engine.
 * Policy variables update immediately; metric effects propagate through a delayed queue.
 */

import {
  CITY_METRICS_DEFAULTS,
  CITY_METRIC_KEYS,
  CITY_POLICY_VARIABLE_DEFAULTS,
  CITY_POLICY_VARIABLE_KEYS,
  CITY_SHOCK_EVENTS,
  EFFECT_DELAY_TICKS,
  edgesFromSource,
  type CityMetricKey,
  type CityPolicyVariableKey,
  type EffectDelayTier,
  type GraphNodeKind,
} from "@/lib/city-metrics-graph";
import {
  applyEconomicPressureDelta,
  DERIVED_ECONOMY_METRIC_KEY,
  finalizeDerivedEconomyForTick,
} from "@/lib/city-metrics-economic-layer";
import type { CityEconomicFiscalContext } from "@/lib/city-economic-indicator";

export type QueuedCityEffect = {
  id: string;
  applyAtTick: number;
  targetKind: GraphNodeKind;
  targetKey: string;
  rawMagnitude: number;
  sourceLabel?: string;
  policyTag?: string;
};

export type CityMetricsShockLogEntry = {
  tick: number;
  shockId: string;
  title: string;
  summary: string;
};

export type CityMetricsEngineState = {
  cityCode: string;
  tick: number;
  seed: number;
  variables: Record<CityPolicyVariableKey, number>;
  metrics: Record<CityMetricKey, number>;
  effectQueue: QueuedCityEffect[];
  pressureLog: Record<string, number>;
  shockCooldowns: Record<string, number>;
  recentShocks: CityMetricsShockLogEntry[];
  /** Policy-graph pressure feeding the derived economy indicator (not a simulated metric). */
  economicPressure?: number;
};

export type CityMetricHistoryPoint = {
  tick: number;
  metrics: Record<CityMetricKey, number>;
  recordedAt: string;
};

export type CityMetricsTickResult = {
  state: CityMetricsEngineState;
  historyPoint: CityMetricHistoryPoint;
  appliedEffects: QueuedCityEffect[];
  triggeredShocks: CityMetricsShockLogEntry[];
};

export type PolicyVariableDelta = Partial<Record<CityPolicyVariableKey, number>>;

const METRIC_MIN = 0;
const METRIC_MAX = 100;
const VARIABLE_MIN = 0;
const VARIABLE_MAX = 100;
const NOISE_FRACTION = 0.1;
const PRESSURE_DECAY = 0.86;
const PRESSURE_GAIN = 0.12;
const REPEAT_PRESSURE_FACTOR = 0.16;

let effectIdCounter = 0;

function nextEffectId(): string {
  effectIdCounter += 1;
  return `fx-${Date.now()}-${effectIdCounter}`;
}

/** Mulberry32 PRNG — deterministic from seed. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededNoiseMultiplier(seed: number, tick: number, key: string): number {
  const rng = mulberry32(seed ^ tick ^ hashString(key));
  const r = rng() * 2 - 1;
  return 1 + r * NOISE_FRACTION;
}

function clampMetric(value: number): number {
  return Math.max(METRIC_MIN, Math.min(METRIC_MAX, Math.round(value)));
}

function clampVariable(value: number): number {
  return Math.max(VARIABLE_MIN, Math.min(VARIABLE_MAX, Math.round(value * 10) / 10));
}

export function createInitialEngineState(input?: {
  cityCode?: string;
  seed?: number;
  metrics?: Partial<Record<CityMetricKey, number>>;
  variables?: Partial<Record<CityPolicyVariableKey, number>>;
}): CityMetricsEngineState {
  return {
    cityCode: input?.cityCode ?? "MB",
    tick: 0,
    seed: input?.seed ?? 0x1a2b3c4d,
    variables: { ...CITY_POLICY_VARIABLE_DEFAULTS, ...input?.variables },
    metrics: { ...CITY_METRICS_DEFAULTS, ...input?.metrics },
    effectQueue: [],
    pressureLog: {},
    shockCooldowns: {},
    recentShocks: [],
  };
}

function delayTicks(delay: EffectDelayTier): number {
  return EFFECT_DELAY_TICKS[delay];
}

function applyDiminishingReturns(
  rawDelta: number,
  currentValue: number,
  pressureLog: Record<string, number>,
  policyTag: string,
): number {
  const pressure = pressureLog[policyTag] ?? 0;
  const repeatFactor = 1 / (1 + pressure * REPEAT_PRESSURE_FACTOR);
  const headroom =
    rawDelta > 0
      ? Math.max(0.08, (METRIC_MAX - currentValue) / 50)
      : Math.max(0.08, currentValue / 50);
  return rawDelta * repeatFactor * headroom;
}

function recordPressure(
  pressureLog: Record<string, number>,
  policyTag: string,
  appliedMagnitude: number,
): void {
  if (!policyTag || appliedMagnitude === 0) return;
  pressureLog[policyTag] = (pressureLog[policyTag] ?? 0) + Math.abs(appliedMagnitude) * PRESSURE_GAIN;
}

function decayPressure(pressureLog: Record<string, number>): void {
  for (const key of Object.keys(pressureLog)) {
    pressureLog[key] = (pressureLog[key] ?? 0) * PRESSURE_DECAY;
    if ((pressureLog[key] ?? 0) < 0.05) delete pressureLog[key];
  }
}

function queueDownstreamEffects(
  queue: QueuedCityEffect[],
  fromKind: GraphNodeKind,
  fromKey: string,
  sourceDelta: number,
  currentTick: number,
  sourceLabel?: string,
): void {
  if (sourceDelta === 0) return;
  for (const edge of edgesFromSource(fromKind, fromKey)) {
    const magnitude = sourceDelta * edge.weight * edge.direction;
    if (magnitude === 0) continue;
    queue.push({
      id: nextEffectId(),
      applyAtTick: currentTick + delayTicks(edge.delay),
      targetKind: edge.to.kind,
      targetKey: edge.to.key,
      rawMagnitude: magnitude,
      sourceLabel,
      policyTag: edge.policyTag ?? (edge.to.kind === "metric" ? edge.to.key : undefined),
    });
  }
}

function applyVariableDelta(
  state: CityMetricsEngineState,
  key: CityPolicyVariableKey,
  delta: number,
  currentTick: number,
  sourceLabel?: string,
): void {
  if (delta === 0) return;
  const before = state.variables[key];
  state.variables[key] = clampVariable(before + delta);
  const actualDelta = state.variables[key] - before;
  queueDownstreamEffects(state.effectQueue, "variable", key, actualDelta, currentTick, sourceLabel);
}

function applyMetricDelta(
  state: CityMetricsEngineState,
  key: CityMetricKey,
  rawDelta: number,
  currentTick: number,
  policyTag: string | undefined,
  sourceLabel: string | undefined,
  seed: number,
  tick: number,
): number {
  if (rawDelta === 0) return 0;

  if (key === DERIVED_ECONOMY_METRIC_KEY) {
    const applied = applyEconomicPressureDelta(state, rawDelta);
    return applied;
  }

  const tag = policyTag ?? key;
  const adjusted = applyDiminishingReturns(rawDelta, state.metrics[key], state.pressureLog, tag);
  const noisy = adjusted * seededNoiseMultiplier(seed, tick, `${key}:${tag}:${sourceLabel ?? ""}`);
  const before = state.metrics[key];
  state.metrics[key] = clampMetric(before + noisy);
  const applied = state.metrics[key] - before;
  recordPressure(state.pressureLog, tag, applied);
  if (applied !== 0) {
    queueDownstreamEffects(state.effectQueue, "metric", key, applied, currentTick, sourceLabel);
  }
  return applied;
}

/** Apply policy variable changes immediately (same tick) and queue downstream metric effects. */
export function enqueuePolicyVariableChanges(
  state: CityMetricsEngineState,
  deltas: PolicyVariableDelta,
  sourceLabel?: string,
): CityMetricsEngineState {
  const next = cloneState(state);
  for (const key of CITY_POLICY_VARIABLE_KEYS) {
    const delta = deltas[key];
    if (delta == null || delta === 0) continue;
    applyVariableDelta(next, key, delta, next.tick, sourceLabel);
  }
  return next;
}

function rollShocks(state: CityMetricsEngineState, tick: number): CityMetricsShockLogEntry[] {
  const triggered: CityMetricsShockLogEntry[] = [];
  const rng = mulberry32(state.seed ^ tick ^ 0x9e3779b9);

  for (const shock of CITY_SHOCK_EVENTS) {
    const cooldown = state.shockCooldowns[shock.id] ?? 0;
    if (cooldown > 0) {
      state.shockCooldowns[shock.id] = cooldown - 1;
      continue;
    }
    if (rng() > shock.probabilityPerTick) continue;

    state.shockCooldowns[shock.id] = shock.cooldownTicks;
    triggered.push({ tick, shockId: shock.id, title: shock.title, summary: shock.summary });

    for (const effect of shock.effects) {
      state.effectQueue.push({
        id: nextEffectId(),
        applyAtTick: tick + delayTicks(effect.delay),
        targetKind: effect.target.kind,
        targetKey: effect.target.key,
        rawMagnitude: effect.magnitude,
        sourceLabel: `shock:${shock.id}`,
        policyTag: effect.policyTag,
      });
    }
  }

  if (triggered.length > 0) {
    state.recentShocks = [...triggered, ...state.recentShocks].slice(0, 12);
  }
  return triggered;
}

function cloneState(state: CityMetricsEngineState): CityMetricsEngineState {
  return {
    ...state,
    variables: { ...state.variables },
    metrics: { ...state.metrics },
    effectQueue: [...state.effectQueue],
    pressureLog: { ...state.pressureLog },
    shockCooldowns: { ...state.shockCooldowns },
    recentShocks: [...state.recentShocks],
    economicPressure: state.economicPressure,
  };
}

/** Advance one simulation tick: apply queued effects, roll shocks, log history. */
export function processCityMetricsTick(
  state: CityMetricsEngineState,
  fiscalContext?: CityEconomicFiscalContext,
): CityMetricsTickResult {
  const next = cloneState(state);
  const tick = next.tick + 1;
  next.tick = tick;

  const due = next.effectQueue.filter((e) => e.applyAtTick <= tick);
  const remaining = next.effectQueue.filter((e) => e.applyAtTick > tick);
  next.effectQueue = remaining;

  const appliedEffects: QueuedCityEffect[] = [];

  for (const effect of due.sort((a, b) => a.applyAtTick - b.applyAtTick)) {
    if (effect.targetKind === "variable") {
      const key = effect.targetKey as CityPolicyVariableKey;
      if (!(key in next.variables)) continue;
      applyVariableDelta(next, key, effect.rawMagnitude, tick, effect.sourceLabel);
    } else {
      const key = effect.targetKey as CityMetricKey;
      if (!(key in next.metrics)) continue;
      const applied = applyMetricDelta(
        next,
        key,
        effect.rawMagnitude,
        tick,
        effect.policyTag,
        effect.sourceLabel,
        next.seed,
        tick,
      );
      if (applied !== 0) appliedEffects.push({ ...effect, rawMagnitude: applied });
    }
  }

  const triggeredShocks = rollShocks(next, tick);
  decayPressure(next.pressureLog);

  if (fiscalContext) {
    finalizeDerivedEconomyForTick(next, fiscalContext, tick);
  }

  const historyPoint: CityMetricHistoryPoint = {
    tick,
    metrics: { ...next.metrics },
    recordedAt: new Date().toISOString(),
  };

  return { state: next, historyPoint, appliedEffects, triggeredShocks };
}

/** Run multiple ticks (e.g. after council session advance). */
export function processCityMetricsTicks(
  state: CityMetricsEngineState,
  count: number,
  fiscalContext?: CityEconomicFiscalContext,
): { state: CityMetricsEngineState; history: CityMetricHistoryPoint[] } {
  let current = state;
  const history: CityMetricHistoryPoint[] = [];
  const n = Math.max(0, Math.min(count, 24));
  for (let i = 0; i < n; i += 1) {
    const result = processCityMetricsTick(current, fiscalContext);
    current = result.state;
    history.push(result.historyPoint);
  }
  return { state: current, history };
}

/** Export JSON time-series per metric for charting. */
export function buildMetricTimeSeries(
  history: CityMetricHistoryPoint[],
): Record<CityMetricKey, { tick: number; value: number; recordedAt: string }[]> {
  const series = Object.fromEntries(
    CITY_METRIC_KEYS.map((k) => [k, [] as { tick: number; value: number; recordedAt: string }[]]),
  ) as Record<CityMetricKey, { tick: number; value: number; recordedAt: string }[]>;

  for (const point of history) {
    for (const key of CITY_METRIC_KEYS) {
      series[key].push({
        tick: point.tick,
        value: point.metrics[key],
        recordedAt: point.recordedAt,
      });
    }
  }
  return series;
}

export function serializeEngineState(state: CityMetricsEngineState): Record<string, unknown> {
  return {
    city_code: state.cityCode,
    sim_tick: state.tick,
    seed: state.seed,
    variables: state.variables,
    metrics: state.metrics,
    effect_queue: state.effectQueue,
    pressure_log: state.pressureLog,
    shock_cooldowns: state.shockCooldowns,
    recent_shocks: state.recentShocks,
    economic_pressure: state.economicPressure ?? 0,
  };
}

export function parseEngineState(raw: Record<string, unknown>): CityMetricsEngineState {
  const base = createInitialEngineState({
    cityCode: String(raw.city_code ?? "MB"),
    seed: Number(raw.seed ?? 0x1a2b3c4d),
  });
  return {
    ...base,
    tick: Number(raw.sim_tick ?? 0),
    seed: Number(raw.seed ?? base.seed),
    variables: { ...base.variables, ...(raw.variables as object) },
    metrics: { ...base.metrics, ...(raw.metrics as object) },
    effectQueue: (raw.effect_queue as QueuedCityEffect[]) ?? [],
    pressureLog: (raw.pressure_log as Record<string, number>) ?? {},
    shockCooldowns: (raw.shock_cooldowns as Record<string, number>) ?? {},
    recentShocks: (raw.recent_shocks as CityMetricsShockLogEntry[]) ?? [],
    economicPressure: Number(raw.economic_pressure ?? 0),
  };
}

export function parseHistoryRows(
  rows: { sim_tick: number; metrics: Record<string, number>; recorded_at: string }[],
): CityMetricHistoryPoint[] {
  return rows.map((r) => ({
    tick: Number(r.sim_tick),
    metrics: { ...CITY_METRICS_DEFAULTS, ...(r.metrics as Partial<Record<CityMetricKey, number>>) },
    recordedAt: r.recorded_at,
  }));
}
