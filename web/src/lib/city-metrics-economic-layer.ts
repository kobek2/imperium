/**
 * Thin adapter: sync derived economy into engine state; redirect graph writes away from propagation.
 */

import {
  computeEconomicIndicator,
  type CityEconomicFiscalContext,
  type CityEconomicInputs,
} from "@/lib/city-economic-indicator";
import type { CityMetricsEngineState } from "@/lib/city-metrics-engine";
import { edgesFromSource, EFFECT_DELAY_TICKS, type EffectDelayTier } from "@/lib/city-metrics-graph";

export const DERIVED_ECONOMY_METRIC_KEY = "economy" as const;

const PRESSURE_MIN = -40;
const PRESSURE_MAX = 40;

function clampPressure(value: number): number {
  return Math.max(PRESSURE_MIN, Math.min(PRESSURE_MAX, Math.round(value * 10) / 10));
}

function delayTicks(delay: EffectDelayTier): number {
  return EFFECT_DELAY_TICKS[delay];
}

export function ensureEconomicPressureState(state: CityMetricsEngineState): number {
  if (typeof state.economicPressure !== "number") {
    state.economicPressure = 0;
  }
  return state.economicPressure;
}

/** Graph edges that targeted economy now accumulate here instead of propagating the metric directly. */
export function applyEconomicPressureDelta(state: CityMetricsEngineState, rawDelta: number): number {
  if (rawDelta === 0) return 0;
  const before = ensureEconomicPressureState(state);
  state.economicPressure = clampPressure(before + rawDelta);
  return state.economicPressure - before;
}

export function syncDerivedEconomyMetric(
  state: CityMetricsEngineState,
  context: CityEconomicFiscalContext,
): { value: number; delta: number } {
  const prev = state.metrics.economy;
  const inputs: CityEconomicInputs = {
    population: context.population,
    businessTaxRevenueMillions: context.businessTaxRevenueMillions,
    salaryPoolMillions: context.salaryPoolMillions,
    economicPressure: ensureEconomicPressureState(state),
  };
  const next = computeEconomicIndicator(inputs);
  state.metrics.economy = next;
  return { value: next, delta: next - prev };
}

export function queueEconomyDownstreamEffects(
  state: CityMetricsEngineState,
  economyDelta: number,
  currentTick: number,
  sourceLabel?: string,
): void {
  if (economyDelta === 0) return;
  for (const edge of edgesFromSource("metric", DERIVED_ECONOMY_METRIC_KEY)) {
    const magnitude = economyDelta * edge.weight * edge.direction;
    if (magnitude === 0) continue;
    state.effectQueue.push({
      id: `fx-eco-${currentTick}-${edge.to.key}-${state.effectQueue.length}`,
      applyAtTick: currentTick + delayTicks(edge.delay),
      targetKind: edge.to.kind,
      targetKey: edge.to.key,
      rawMagnitude: magnitude,
      sourceLabel: sourceLabel ?? "derived:economy",
      policyTag: edge.policyTag ?? (edge.to.kind === "metric" ? edge.to.key : undefined),
    });
  }
}

export function finalizeDerivedEconomyForTick(
  state: CityMetricsEngineState,
  context: CityEconomicFiscalContext | undefined,
  tick: number,
): number {
  if (!context) return 0;
  const { delta } = syncDerivedEconomyMetric(state, context);
  if (delta !== 0) {
    queueEconomyDownstreamEffects(state, delta, tick, "derived:economy");
  }
  return delta;
}
