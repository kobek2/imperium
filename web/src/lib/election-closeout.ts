import type { SupabaseClient } from "@supabase/supabase-js";
import { districtLeanBonus } from "@/lib/fec";
import { scoreGeneralElection, type Party } from "@/lib/election-engine";
import { leanTiePriority } from "@/lib/election-tiebreak";
import { finalizeElectionPartyNominees, seedElectionNpcOpponents } from "@/lib/election-npc-opponents";
import { throwIfPostgrestError } from "@/lib/supabase-error";

export type ElectionPhase = "filing" | "primary" | "general" | "closed";

export const ELECTION_PHASE_FORWARD: Record<ElectionPhase, ElectionPhase[]> = {
  filing: ["primary", "general", "closed"],
  primary: ["general", "closed"],
  general: ["closed"],
  closed: [],
};

export function canReachPhaseForward(prev: ElectionPhase, target: ElectionPhase): boolean {
  return ELECTION_PHASE_FORWARD[prev].includes(target);
}

type FilingCandidate = {
  id: string;
  user_id: string | null;
  party: string;
  campaign_points_total: number | null;
  primary_winner: boolean | null;
  created_at: string | null;
  is_npc?: boolean | null;
  npc_name?: string | null;
  npc_synthetic_votes?: number | null;
};

type EndorsementRow = {
  candidate_id: string;
  points: number | null;
};

/** Sort helper: most votes first, tiebreak by earliest filing time (then stable on id). */
function sortByVotesThenFilingOrder<T extends { id: string; created_at: string | null }>(
  arr: T[],
  votes: Record<string, number>,
) {
  return [...arr].sort((a, b) => {
    const va = votes[a.id] ?? 0;
    const vb = votes[b.id] ?? 0;
    if (va !== vb) return vb - va;
    const ta = a.created_at ? new Date(a.created_at).getTime() : Number.MAX_SAFE_INTEGER;
    const tb = b.created_at ? new Date(b.created_at).getTime() : Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

/** House/Senate/president point race: highest point share wins; ties use 2024 lean, then earliest filing. */
function sortByBlendedScoreThenLeanThenFiling<
  T extends { id: string; party: string; created_at: string | null },
>(arr: T[], scores: Record<string, number>, signedMargin: number) {
  return [...arr].sort((a, b) => {
    const sa = scores[a.id] ?? 0;
    const sb = scores[b.id] ?? 0;
    if (sa !== sb) return sb - sa;
    const la = leanTiePriority(a.party, signedMargin);
    const lb = leanTiePriority(b.party, signedMargin);
    if (la !== lb) return lb - la;
    const ta = a.created_at ? new Date(a.created_at).getTime() : Number.MAX_SAFE_INTEGER;
    const tb = b.created_at ? new Date(b.created_at).getTime() : Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Picks one nominee per party from primary_votes plurality.
 * Democrat/Republican player winners replace their party's NPC placeholder.
 * Parties with no player filers keep the NPC nominee.
 */
export async function pickPrimaryWinners(supabase: SupabaseClient, election_id: string) {
  await finalizeElectionPartyNominees(supabase, election_id);
}

/** National presidential race — points-only scoring (no electoral college). */
export async function computePresidentialWinnerUserId(
  supabase: SupabaseClient,
  election_id: string,
): Promise<string | null> {
  const result = await resolveGeneralElectionWinner(supabase, election_id, {
    office: "president",
    district_code: null,
    state: null,
  });
  return result.winner_user_id;
}

export type ElectionWinnerResult = {
  winner_user_id: string | null;
  winner_candidate_id: string | null;
};

/**
 * Resolve a general-election winner for admin-forced closes.
 * Player winners set winner_user_id; NPC winners set winner_candidate_id only.
 */
export async function resolveGeneralElectionWinner(
  supabase: SupabaseClient,
  election_id: string,
  meta: {
    office: string;
    district_code: string | null;
    state: string | null;
    leadership_role?: string | null;
  },
): Promise<ElectionWinnerResult> {
  const none: ElectionWinnerResult = { winner_user_id: null, winner_candidate_id: null };
  await seedElectionNpcOpponents(supabase, election_id);

  const { data: candidates } = await supabase
    .from("election_candidates")
    .select(
      "id, user_id, party, campaign_points_total, primary_winner, created_at, is_npc, npc_name, npc_synthetic_votes",
    )
    .eq("election_id", election_id);

  const candList = (candidates ?? []) as FilingCandidate[];
  if (!candList.length) return none;

  const hasPrimaryFlag = candList.some((c) => c.primary_winner);
  const active = hasPrimaryFlag ? candList.filter((c) => c.primary_winner) : candList;
  if (!active.length) return none;

  const { data: endorsements } = await supabase
    .from("campaign_endorsements")
    .select("candidate_id, points")
    .eq("election_id", election_id);
  const tally: Record<string, number> = {};
  const endorsementTotals: Record<string, number> = {};
  for (const e of (endorsements ?? []) as EndorsementRow[]) {
    endorsementTotals[e.candidate_id] =
      (endorsementTotals[e.candidate_id] ?? 0) + Number(e.points ?? 0);
  }

  if (meta.leadership_role) {
    const { data: gv } = await supabase
      .from("general_votes")
      .select("candidate_id")
      .eq("election_id", election_id);
    for (const v of gv ?? []) {
      tally[v.candidate_id] = (tally[v.candidate_id] ?? 0) + 1;
    }
    const sorted = sortByVotesThenFilingOrder(active, tally);
    const top = sorted[0]!;
    return { winner_user_id: top.user_id, winner_candidate_id: top.id };
  }

  if (meta.office === "president") {
    const inputs = active.map((c) => ({
      id: c.id,
      party: c.party as Party,
      campaignPoints:
        Math.max(0, Number(c.campaign_points_total ?? 0)) +
        Math.max(0, endorsementTotals[c.id] ?? 0),
    }));
    const scores = scoreGeneralElection(inputs, {});
    const ranked = sortByBlendedScoreThenLeanThenFiling(active, scores, 0);
    const top = ranked[0]!;
    return {
      winner_user_id: top.is_npc ? null : top.user_id,
      winner_candidate_id: top.id,
    };
  }

  if (meta.office !== "house" && meta.office !== "senate") {
    const { data: gv } = await supabase
      .from("general_votes")
      .select("candidate_id")
      .eq("election_id", election_id);
    for (const v of gv ?? []) {
      tally[v.candidate_id] = (tally[v.candidate_id] ?? 0) + 1;
    }
    const sorted = sortByVotesThenFilingOrder(active, tally);
    const top = sorted[0]!;
    return { winner_user_id: top.user_id, winner_candidate_id: top.id };
  }

  let partisanLean = 0;
  if (meta.office === "house" && meta.district_code) {
    const { data: d } = await supabase
      .from("districts")
      .select("pvi")
      .eq("code", meta.district_code)
      .maybeSingle();
    partisanLean = Number(d?.pvi ?? 0);
  } else if (meta.office === "senate" && meta.state) {
    const { data: s } = await supabase
      .from("states")
      .select("pvi")
      .eq("code", meta.state)
      .maybeSingle();
    partisanLean = Number(s?.pvi ?? 0);
  }

  function leanFor(party: string) {
    if (party === "democrat") return districtLeanBonus(partisanLean, "democrat");
    if (party === "republican") return districtLeanBonus(partisanLean, "republican");
    return 0;
  }

  const inputs = active.map((c) => ({
    id: c.id,
    party: c.party as Party,
    campaignPoints:
      Math.max(0, Number(c.campaign_points_total ?? 0)) +
      Math.max(0, endorsementTotals[c.id] ?? 0) +
      leanFor(c.party),
  }));

  const scores = scoreGeneralElection(inputs, {});
  const ranked = sortByBlendedScoreThenLeanThenFiling(active, scores, partisanLean);
  const top = ranked[0]!;
  return {
    winner_user_id: top.is_npc ? null : top.user_id,
    winner_candidate_id: top.id,
  };
}

/**
 * @deprecated Prefer resolveGeneralElectionWinner for closeout (supports NPC winners).
 */
export async function computeGeneralWinner(
  supabase: SupabaseClient,
  election_id: string,
  meta: {
    office: string;
    district_code: string | null;
    state: string | null;
    leadership_role?: string | null;
  },
): Promise<string | null> {
  const result = await resolveGeneralElectionWinner(supabase, election_id, meta);
  return result.winner_user_id;
}

export type ElectionCloseRow = {
  id: string;
  phase: ElectionPhase;
  office: string;
  state: string | null;
  district_code: string | null;
  leadership_role: string | null;
};

/**
 * Shared closeout for seat races moving into `closed` (primary winners if needed, then general winner).
 * Used by setElectionPhase and bulkEndElections so behaviour stays aligned.
 */
export async function finalizeElectionToClosed(
  supabase: SupabaseClient,
  current: ElectionCloseRow,
): Promise<ElectionWinnerResult> {
  const id = current.id;
  const prevPhase = current.phase;

  const isForward = canReachPhaseForward(prevPhase, "closed");

  if (isForward) {
    if ((prevPhase === "filing" || prevPhase === "primary") && !current.leadership_role) {
      await pickPrimaryWinners(supabase, id);
    }
  }

  if (!isForward) {
    return { winner_user_id: null, winner_candidate_id: null };
  }

  return resolveGeneralElectionWinner(supabase, id, {
    office: current.office,
    district_code: current.district_code,
    state: current.state,
    leadership_role: current.leadership_role,
  });
}
