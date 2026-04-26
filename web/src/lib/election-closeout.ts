import type { SupabaseClient } from "@supabase/supabase-js";
import { districtLeanBonus } from "@/lib/fec";
import { scoreGeneralElection, type Party } from "@/lib/election-engine";
import { leanTiePriority } from "@/lib/election-tiebreak";
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
  user_id: string;
  party: string;
  campaign_points_total: number | null;
  primary_winner: boolean | null;
  created_at: string | null;
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

/** House/Senate general: highest blended score wins; ties use 2024 lean, then earliest filing. */
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
 * Ties (including everyone-at-zero) resolve to the earliest filer, then lexicographically smallest id.
 * Idempotent — safe to call when some primary_winner flags are already set.
 */
export async function pickPrimaryWinners(supabase: SupabaseClient, election_id: string) {
  const { data: candidates } = await supabase
    .from("election_candidates")
    .select("id, user_id, party, campaign_points_total, primary_winner, created_at")
    .eq("election_id", election_id);

  const candList = (candidates ?? []) as FilingCandidate[];
  if (!candList.length) return;

  const { data: votes } = await supabase
    .from("primary_votes")
    .select("candidate_id")
    .eq("election_id", election_id);
  const counts: Record<string, number> = {};
  for (const v of votes ?? []) {
    counts[v.candidate_id] = (counts[v.candidate_id] ?? 0) + 1;
  }

  const byParty = new Map<string, FilingCandidate[]>();
  for (const c of candList) {
    const list = byParty.get(c.party) ?? [];
    list.push(c);
    byParty.set(c.party, list);
  }

  const winnerIds = new Set<string>();
  for (const group of byParty.values()) {
    const sorted = sortByVotesThenFilingOrder(group, counts);
    if (sorted.length) winnerIds.add(sorted[0]!.id);
  }

  for (const c of candList) {
    const shouldBeWinner = winnerIds.has(c.id);
    if ((c.primary_winner ?? false) === shouldBeWinner) continue;
    const { error } = await supabase
      .from("election_candidates")
      .update({ primary_winner: shouldBeWinner })
      .eq("id", c.id);
    throwIfPostgrestError(error);
  }

  // Once nominees are selected, remove non-winners from this race so every downstream
  // view/query (dashboard counts, map/tote, finalization) sees the true general ballot.
  const loserIds = candList.filter((c) => !winnerIds.has(c.id)).map((c) => c.id);
  if (loserIds.length) {
    const { error: delErr } = await supabase
      .from("election_candidates")
      .delete()
      .in("id", loserIds)
      .eq("election_id", election_id);
    throwIfPostgrestError(delErr);
  }
}

/**
 * Resolve a general-election winner for admin-forced closes.
 * House / Senate:   full 60/40 scoring (campaign pts + lean + community votes). Score ties
 *                   break by 2024 presidential margin alignment, then earliest filing.
 * President / other: plurality of general_votes (president is certified via finalizePresident).
 * If nobody has any votes, the earliest filer wins. If zero candidates, returns null.
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
  const { data: candidates } = await supabase
    .from("election_candidates")
    .select("id, user_id, party, campaign_points_total, primary_winner, created_at")
    .eq("election_id", election_id);

  const candList = (candidates ?? []) as FilingCandidate[];
  if (!candList.length) return null;

  const hasPrimaryFlag = candList.some((c) => c.primary_winner);
  const active = hasPrimaryFlag ? candList.filter((c) => c.primary_winner) : candList;
  if (!active.length) return null;

  const { data: gv } = await supabase
    .from("general_votes")
    .select("candidate_id")
    .eq("election_id", election_id);
  const { data: endorsements } = await supabase
    .from("campaign_endorsements")
    .select("candidate_id, points")
    .eq("election_id", election_id);
  const tally: Record<string, number> = {};
  for (const v of gv ?? []) {
    tally[v.candidate_id] = (tally[v.candidate_id] ?? 0) + 1;
  }
  const endorsementTotals: Record<string, number> = {};
  for (const e of (endorsements ?? []) as EndorsementRow[]) {
    endorsementTotals[e.candidate_id] =
      (endorsementTotals[e.candidate_id] ?? 0) + Number(e.points ?? 0);
  }

  if (meta.leadership_role) {
    const sorted = sortByVotesThenFilingOrder(active, tally);
    return sorted[0]!.user_id;
  }

  if (meta.office !== "house" && meta.office !== "senate") {
    const sorted = sortByVotesThenFilingOrder(active, tally);
    return sorted[0]!.user_id;
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

  const scores = scoreGeneralElection(inputs, tally);
  const ranked = sortByBlendedScoreThenLeanThenFiling(active, scores, partisanLean);
  return ranked[0]!.user_id;
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
): Promise<{ winner_user_id: string | null }> {
  const id = current.id;
  const prevPhase = current.phase;

  const isForward = canReachPhaseForward(prevPhase, "closed");

  if (isForward) {
    if ((prevPhase === "filing" || prevPhase === "primary") && !current.leadership_role) {
      await pickPrimaryWinners(supabase, id);
    }
  }

  let winnerUserId: string | null = null;
  if (isForward) {
    winnerUserId = await computeGeneralWinner(supabase, id, {
      office: current.office,
      district_code: current.district_code,
      state: current.state,
      leadership_role: current.leadership_role,
    });
  }

  return { winner_user_id: winnerUserId };
}
