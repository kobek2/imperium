"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  advanceCityMetricsTicks,
  applyCityPolicyAndTick,
  loadCityMetricsSnapshot,
  type CityMetricsSnapshot,
} from "@/lib/city-metrics-data";
import {
  budgetToPolicyVariableDeltas,
  ordinanceToPolicyVariableDeltas,
} from "@/lib/city-metrics-policy-bridge";
import { NYC_CITY_CODE } from "@/lib/city";

export type CityMetricsActionResult = {
  ok: boolean;
  message: string;
  snapshot?: CityMetricsSnapshot;
};

function revalidateMetricsPaths() {
  for (const p of ["/council", "/mayor", "/"]) revalidatePath(p);
}

export async function advanceCityMetricsTickAction(
  tickCount = 1,
): Promise<CityMetricsActionResult> {
  const supabase = await createClient();
  const result = await advanceCityMetricsTicks(supabase, tickCount, NYC_CITY_CODE);
  if (!result.ok) return { ok: false, message: result.error ?? "Tick failed." };
  revalidateMetricsPaths();
  return {
    ok: true,
    message: `Sim advanced ${tickCount} tick(s) — now at ${result.snapshot?.state.tick ?? "?"}.`,
    snapshot: result.snapshot,
  };
}

export async function applyOrdinanceMetricsEngine(input: {
  category: string;
  issueKey: string;
  stanceKey?: string | null;
  stanceParams?: { rate_delta: number; earmark_services_pct: number } | null;
  title: string;
}): Promise<CityMetricsActionResult> {
  const supabase = await createClient();
  const deltas = ordinanceToPolicyVariableDeltas(
    input.category,
    input.issueKey,
    input.stanceKey,
    input.stanceParams,
  );
  const result = await applyCityPolicyAndTick(supabase, {
    policyDeltas: deltas,
    sourceLabel: `ordinance:${input.title}`,
    tickCount: 1,
  });
  if (!result.ok) return { ok: false, message: result.error ?? "Engine update failed." };
  revalidateMetricsPaths();
  return { ok: true, message: "Ordinance variables queued through metrics engine.", snapshot: result.snapshot };
}

export async function applyBudgetMetricsEngine(input: {
  departments: { departmentKey: string; amountMillions: number }[];
  deficitMillions: number;
  fiscalYear: number;
}): Promise<CityMetricsActionResult> {
  const supabase = await createClient();
  const deltas = budgetToPolicyVariableDeltas(input.departments, input.deficitMillions);
  const result = await applyCityPolicyAndTick(supabase, {
    policyDeltas: deltas,
    sourceLabel: `budget:FY${input.fiscalYear}`,
    tickCount: 1,
  });
  if (!result.ok) return { ok: false, message: result.error ?? "Engine update failed." };
  revalidateMetricsPaths();
  return { ok: true, message: "Budget variables queued through metrics engine.", snapshot: result.snapshot };
}

export async function fetchCityMetricsSnapshot(): Promise<CityMetricsSnapshot | null> {
  const supabase = await createClient();
  return loadCityMetricsSnapshot(supabase, NYC_CITY_CODE);
}
