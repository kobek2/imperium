/**
 * Helpers for showing admins which seats actually have players living in them.
 *
 * These are intentionally server-only; they join profiles against the full list of districts
 * and states so empty seats still show up (as "0 players"). The admin uses this to avoid
 * spinning up a bunch of elections in seats nobody lives in.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type DistrictPopulation = {
  code: string;
  state: string;
  player_count: number;
  incumbent_party: string | null;
  incumbent_npc_name: string | null;
};

export type StatePopulation = {
  code: string;
  name: string;
  player_count: number;
  pvi: number;
};

export async function loadDistrictPopulations(
  supabase: SupabaseClient,
): Promise<DistrictPopulation[]> {
  const [districtsRes, profilesRes] = await Promise.all([
    supabase
      .from("districts")
      .select("code, state, incumbent_party, incumbent_npc_name")
      .order("code"),
    supabase
      .from("profiles")
      .select("home_district_code")
      .not("home_district_code", "is", null),
  ]);

  const counts = new Map<string, number>();
  for (const row of (profilesRes.data ?? []) as Array<{ home_district_code: string | null }>) {
    const code = (row.home_district_code ?? "").trim().toUpperCase();
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  const districts = (districtsRes.data ?? []) as Array<{
    code: string;
    state: string;
    incumbent_party: string | null;
    incumbent_npc_name: string | null;
  }>;

  return districts.map((d) => ({
    code: d.code,
    state: d.state,
    player_count: counts.get(d.code.toUpperCase()) ?? 0,
    incumbent_party: d.incumbent_party,
    incumbent_npc_name: d.incumbent_npc_name,
  }));
}

export async function loadStatePopulations(
  supabase: SupabaseClient,
): Promise<StatePopulation[]> {
  const [statesRes, profilesRes] = await Promise.all([
    supabase.from("states").select("code, name, pvi").order("code"),
    supabase
      .from("profiles")
      .select("residence_state")
      .not("residence_state", "is", null),
  ]);

  const counts = new Map<string, number>();
  for (const row of (profilesRes.data ?? []) as Array<{ residence_state: string | null }>) {
    const code = (row.residence_state ?? "").trim().toUpperCase();
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  const states = (statesRes.data ?? []) as Array<{
    code: string;
    name: string;
    pvi: number | null;
  }>;

  return states.map((s) => ({
    code: s.code,
    name: s.name,
    player_count: counts.get(s.code.toUpperCase()) ?? 0,
    pvi: Number(s.pvi ?? 0),
  }));
}

export async function countTotalPlayers(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true });
  return count ?? 0;
}
