/**
 * Presidential general-election scoring.
 *
 * Each state scores independently:
 *   - 60% weight: share of campaign points in that state. Points come from speeches +
 *     rallies whose `target_state` matches, plus the state's PVI applied as a party
 *     lean bonus (mirroring how House/Senate scoring works).
 *   - 40% weight: share of general_votes whose `voter_state` matches.
 *
 * The top-scoring candidate in a state wins all of that state's electoral votes
 * (winner-take-all). Ties are broken by filing order (earliest filer wins), matching
 * the rest of the election engine.
 *
 * The overall winner of the race is the candidate with the most electoral votes.
 * If no one hits 270, we still return the plurality leader — this is a simulator,
 * not a Constitutional contingent-election tool.
 */

import { districtLeanBonus } from "@/lib/fec";
import { STATE_ELECTORAL_VOTES as FALLBACK_EV } from "@/lib/electoral-votes";

export type PresCandidate = {
  id: string;
  user_id: string;
  party: "democrat" | "republican" | "independent" | string;
  created_at?: string | null;
};

export type PresStateMeta = {
  code: string;
  name: string;
  pvi: number;
  electoral_votes: number;
};

export type PresVote = {
  candidate_id: string;
  voter_state: string | null;
};

export type PresCampaignEvent = {
  candidate_id: string;
  target_state: string | null;
  points: number;
};

export type CandidateStateScore = {
  candidate_id: string;
  points: number;
  points_with_lean: number;
  points_share: number;
  votes: number;
  votes_share: number;
  score: number;
};

export type StateResult = {
  code: string;
  name: string;
  pvi: number;
  electoral_votes: number;
  scores: CandidateStateScore[];
  winner_candidate_id: string | null;
  total_points: number;
  total_votes: number;
};

export type PresidentialResult = {
  byState: Record<string, StateResult>;
  electoralVotesByCandidate: Record<string, number>;
  winnerCandidateId: string | null;
  totalElectoralVotes: number;
};

/** Turn a state's PVI (+D, -R) into a candidate-specific bonus added to raw campaign points. */
function leanFor(party: string, pvi: number): number {
  if (party === "democrat") return districtLeanBonus(pvi, "democrat");
  if (party === "republican") return districtLeanBonus(pvi, "republican");
  return 0;
}

function filingRank(c: PresCandidate): number {
  const t = c.created_at ? Date.parse(c.created_at) : NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * Score a single state. `stateCode` must be uppercase (e.g. "CA").
 *
 * - `votes` should already be filtered to rows where `voter_state === stateCode`.
 * - `events` should already be filtered to rows where `target_state === stateCode`.
 */
export function scorePresidentialState(
  stateCode: string,
  stateMeta: PresStateMeta,
  candidates: PresCandidate[],
  votes: PresVote[],
  events: PresCampaignEvent[],
): StateResult {
  const pointsByCand: Record<string, number> = {};
  for (const c of candidates) pointsByCand[c.id] = 0;
  for (const e of events) {
    if (!e.target_state || e.target_state.toUpperCase() !== stateCode) continue;
    if (!(e.candidate_id in pointsByCand)) continue;
    pointsByCand[e.candidate_id] += Number(e.points ?? 0);
  }

  const votesByCand: Record<string, number> = {};
  for (const c of candidates) votesByCand[c.id] = 0;
  for (const v of votes) {
    if (!v.voter_state || v.voter_state.toUpperCase() !== stateCode) continue;
    if (!(v.candidate_id in votesByCand)) continue;
    votesByCand[v.candidate_id] += 1;
  }

  // Apply PVI lean to raw points per candidate. Floor at zero so a very red state
  // can't give a Democrat negative campaign credit; they just get nothing from lean.
  const pointsWithLean: Record<string, number> = {};
  let totalPoints = 0;
  for (const c of candidates) {
    const adj = Math.max(0, pointsByCand[c.id]! + leanFor(c.party, stateMeta.pvi));
    pointsWithLean[c.id] = adj;
    totalPoints += adj;
  }

  let totalVotes = 0;
  for (const c of candidates) totalVotes += votesByCand[c.id]!;

  const activeCount = candidates.length || 1;
  const scores: CandidateStateScore[] = candidates.map((c) => {
    const p = pointsWithLean[c.id]!;
    const v = votesByCand[c.id]!;
    const pShare = totalPoints > 0 ? p / totalPoints : 1 / activeCount;
    const vShare = totalVotes > 0 ? v / totalVotes : 1 / activeCount;
    const score = 0.6 * pShare + 0.4 * vShare;
    return {
      candidate_id: c.id,
      points: pointsByCand[c.id]!,
      points_with_lean: p,
      points_share: pShare,
      votes: v,
      votes_share: vShare,
      score,
    };
  });

  // Winner = max score; filing-order tiebreak so the earliest filer wins on a tie.
  let winner: { id: string; score: number; rank: number } | null = null;
  for (const c of candidates) {
    const s = scores.find((x) => x.candidate_id === c.id)!;
    const rank = filingRank(c);
    if (!winner) {
      winner = { id: c.id, score: s.score, rank };
      continue;
    }
    if (s.score > winner.score || (s.score === winner.score && rank < winner.rank)) {
      winner = { id: c.id, score: s.score, rank };
    }
  }

  return {
    code: stateCode,
    name: stateMeta.name,
    pvi: stateMeta.pvi,
    electoral_votes: stateMeta.electoral_votes,
    scores,
    winner_candidate_id: winner?.id ?? null,
    total_points: totalPoints,
    total_votes: totalVotes,
  };
}

/** Full-country presidential scoring. `stateMetas` should include every state you want tallied. */
export function scorePresidentialElection(
  candidates: PresCandidate[],
  stateMetas: PresStateMeta[],
  votes: PresVote[],
  events: PresCampaignEvent[],
): PresidentialResult {
  // Bucket votes and events by state up front so each state's score call is O(active rows)
  // instead of re-scanning every ballot for every state.
  const votesByState = new Map<string, PresVote[]>();
  for (const v of votes) {
    const k = (v.voter_state ?? "").toUpperCase();
    if (!k) continue;
    let arr = votesByState.get(k);
    if (!arr) {
      arr = [];
      votesByState.set(k, arr);
    }
    arr.push(v);
  }
  const eventsByState = new Map<string, PresCampaignEvent[]>();
  for (const e of events) {
    const k = (e.target_state ?? "").toUpperCase();
    if (!k) continue;
    let arr = eventsByState.get(k);
    if (!arr) {
      arr = [];
      eventsByState.set(k, arr);
    }
    arr.push(e);
  }

  const byState: Record<string, StateResult> = {};
  const evByCand: Record<string, number> = {};
  for (const c of candidates) evByCand[c.id] = 0;
  let totalEV = 0;

  for (const meta of stateMetas) {
    const code = meta.code.toUpperCase();
    const ev = meta.electoral_votes > 0 ? meta.electoral_votes : (FALLBACK_EV[code] ?? 0);
    const mergedMeta: PresStateMeta = { ...meta, code, electoral_votes: ev };
    const result = scorePresidentialState(
      code,
      mergedMeta,
      candidates,
      votesByState.get(code) ?? [],
      eventsByState.get(code) ?? [],
    );
    byState[code] = result;
    totalEV += ev;
    if (result.winner_candidate_id) {
      evByCand[result.winner_candidate_id] = (evByCand[result.winner_candidate_id] ?? 0) + ev;
    }
  }

  // Pick overall winner by EV total; filing-order tiebreak.
  let winnerId: string | null = null;
  let winnerEV = -1;
  let winnerRank = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const ev = evByCand[c.id] ?? 0;
    const rank = filingRank(c);
    if (ev > winnerEV || (ev === winnerEV && rank < winnerRank)) {
      winnerId = c.id;
      winnerEV = ev;
      winnerRank = rank;
    }
  }
  if (winnerEV <= 0) winnerId = null;

  return {
    byState,
    electoralVotesByCandidate: evByCand,
    winnerCandidateId: winnerId,
    totalElectoralVotes: totalEV,
  };
}
