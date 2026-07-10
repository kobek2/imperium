import type { SupabaseClient } from "@supabase/supabase-js";
import { NYC_COUNCIL_DISTRICT_CODES, councilDistrictByCode } from "@/lib/city";
import { CAMPAIGN_CYCLE_TURNS } from "@/lib/campaign-day-cycle";
import {
  signedMarginForMayor,
  type WardElectoralInput,
  WARD_POPULATION_SHARE,
} from "@/lib/city-mayoral-electoral-approval";
import {
  aggregateWardDepartmentPriorities,
  type WardCaucusProfile,
} from "@/lib/city-ward-priorities";

export type CityApprovalContext = {
  wardElectoral: WardElectoralInput[];
  wardPriorities: Record<string, Record<string, number>>;
  mayorParty: string;
  mayorElectoralApproval: number | null;
};

export async function loadCouncilCaucusProfiles(supabase: SupabaseClient): Promise<WardCaucusProfile[]> {
  const { data: round } = await supabase
    .from("legislative_rounds")
    .select("featured_issue_keys")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const featured = Array.isArray(round?.featured_issue_keys)
    ? (round.featured_issue_keys as string[])
    : [];

  const { data: rows } = await supabase
    .from("campaign_caucus_members")
    .select(
      "seat_label, party, sim_politicians(ideology_economic, ideology_social, ideology_pragmatism)",
    )
    .eq("chamber", "council");

  return (rows ?? []).map((r) => {
    const sp = r.sim_politicians as {
      ideology_economic?: number;
      ideology_social?: number;
      ideology_pragmatism?: number;
    } | null;
    return {
      wardCode: String(r.seat_label ?? "").toUpperCase(),
      party: String(r.party ?? "democrat"),
      ideologyEconomic: Number(sp?.ideology_economic ?? 0),
      ideologySocial: Number(sp?.ideology_social ?? 0),
      ideologyPragmatism: Number(sp?.ideology_pragmatism ?? 50),
      featuredIssues: featured,
    };
  });
}

async function loadMayorParty(supabase: SupabaseClient): Promise<string> {
  const { data: grant } = await supabase
    .from("government_role_grants")
    .select("user_id")
    .eq("role_key", "mayor")
    .maybeSingle();

  if (!grant?.user_id) return "democrat";

  const { data: profile } = await supabase
    .from("profiles")
    .select("party")
    .eq("id", grant.user_id)
    .maybeSingle();

  if (profile?.party) return String(profile.party);

  const { data: ward } = await supabase
    .from("wards")
    .select("incumbent_party")
    .eq("city_code", "MB")
    .limit(1)
    .maybeSingle();

  const p = ward?.incumbent_party;
  if (p === "D") return "democrat";
  if (p === "R") return "republican";
  return "democrat";
}

/** Ward signed margins from latest closed council elections, with PVI fallback. */
export async function loadWardElectoralInputs(
  supabase: SupabaseClient,
  mayorParty: string,
  currentSimTick: number,
): Promise<WardElectoralInput[]> {
  const { data: rpcData } = await supabase.rpc("get_city_ward_election_margins", {
    p_mayor_party: mayorParty,
  });

  if (rpcData && typeof rpcData === "object" && Array.isArray((rpcData as { wards?: unknown }).wards)) {
    const payload = rpcData as {
      wards: {
        ward_code: string;
        signed_margin: number;
        ticks_since_election: number;
        population_share?: number;
      }[];
    };
    return payload.wards.map((w) => ({
      wardCode: w.ward_code,
      signedMargin: Number(w.signed_margin),
      ticksSinceElection: Number(w.ticks_since_election ?? 0),
      populationShare: w.population_share != null ? Number(w.population_share) : undefined,
    }));
  }

  const { data: elections } = await supabase
    .from("elections")
    .select("id, ward_code, created_at, phase")
    .eq("office", "council_ward")
    .eq("phase", "closed")
    .not("ward_code", "is", null)
    .order("created_at", { ascending: false });

  const latestByWard = new Map<string, { id: string; createdAt: string }>();
  for (const e of elections ?? []) {
    const code = String(e.ward_code ?? "").toUpperCase();
    if (!code || latestByWard.has(code)) continue;
    latestByWard.set(code, { id: e.id, createdAt: e.created_at });
  }

  const out: WardElectoralInput[] = [];

  for (const code of NYC_COUNCIL_DISTRICT_CODES) {
    const race = latestByWard.get(code);
    let signedMargin = 0;
    let ticksSince = currentSimTick;

    if (race) {
      const { data: cands } = await supabase
        .from("election_candidates")
        .select("id, party, npc_synthetic_votes")
        .eq("election_id", race.id);

      const votes = await Promise.all(
        (cands ?? []).map(async (c) => {
          const { count } = await supabase
            .from("general_votes")
            .select("id", { count: "exact", head: true })
            .eq("election_id", race.id)
            .eq("candidate_id", c.id);
          return {
            party: String(c.party),
            votes: Number(count ?? 0) + Number(c.npc_synthetic_votes ?? 0),
          };
        }),
      );

      const total = votes.reduce((s, v) => s + v.votes, 0);
      if (total > 0) {
        const winner = [...votes].sort((a, b) => b.votes - a.votes)[0];
        signedMargin = signedMarginForMayor(winner.party, mayorParty, winner.votes / total);
      }

      const ageMs = Date.now() - new Date(race.createdAt).getTime();
      ticksSince = Math.max(0, Math.floor(ageMs / (3600_000 * 4)));
    } else {
      const district = councilDistrictByCode(code);
      const pvi = district?.pvi ?? 0;
      const incumbentParty = district?.incumbentParty ?? "democrat";
      const proxyShare = 0.5 + Math.min(0.45, Math.abs(pvi) / 80);
      signedMargin = signedMarginForMayor(incumbentParty, mayorParty, proxyShare);
      ticksSince = CAMPAIGN_CYCLE_TURNS;
    }

    out.push({
      wardCode: code,
      signedMargin,
      ticksSinceElection: ticksSince,
      populationShare: WARD_POPULATION_SHARE[code],
    });
  }

  return out;
}

export async function loadCityApprovalContext(
  supabase: SupabaseClient,
  input: { simTick: number; cityPopulation: number; mayorElectoralApproval?: number | null },
): Promise<CityApprovalContext> {
  const mayorParty = await loadMayorParty(supabase);
  const caucus = await loadCouncilCaucusProfiles(supabase);
  const wardPriorities = aggregateWardDepartmentPriorities(caucus);
  const wardElectoral = await loadWardElectoralInputs(supabase, mayorParty, input.simTick);

  return {
    wardElectoral,
    wardPriorities,
    mayorParty,
    mayorElectoralApproval: input.mayorElectoralApproval ?? null,
  };
}
