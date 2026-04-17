import { ELECTION_WEIGHTS } from "@/lib/fec";
import { regionForState, type UsRegion } from "@/lib/regions";

export type Party = "democrat" | "republican" | "independent";

export type CandidateInput = {
  id: string;
  party: Party;
  /** Raw campaign + endorsements + district/state lean, before normalization. */
  campaignPoints: number;
};

export type CommunityTally = Record<string, number>;

/**
 * House / Senate / non-presidential general:
 * 60% from normalized campaign scores; 40% from normalized popular vote counts.
 */
export function scoreGeneralElection(candidates: CandidateInput[], votes: CommunityTally) {
  const camp = normalize(candidates.map((c) => ({ id: c.id, w: Math.max(0, c.campaignPoints) })));
  const pop = normalize(
    candidates.map((c) => ({ id: c.id, w: Math.max(0, votes[c.id] ?? 0) })),
  );

  return finalize(candidates, camp, pop);
}

export type PresidentialStateInput = {
  state: string;
  candidates: CandidateInput[];
  /** Popular votes for this state only (40% still applied via region — see below). */
  votesByCandidate: CommunityTally;
};

export type RegionalVote = {
  region: UsRegion;
  votesByCandidate: CommunityTally;
};

/**
 * Presidential model (per your spec):
 * - 60%: campaign points are tracked **per state** (caller passes per-state points on each candidate).
 * - 40%: community votes are tallied **by region**, then each state's 40% slice uses the same
 *   regional percentage split across all states in that region.
 */
export function scorePresidentialElection(
  perState: PresidentialStateInput[],
  regionalCommunityVotes: RegionalVote[],
) {
  const stateResults: Record<
    string,
    { winnerId?: string; scores: Record<string, number> }
  > = {};

  const regionPop = aggregateRegionalShares(regionalCommunityVotes);

  for (const row of perState) {
    const region = regionForState(row.state);
    if (!region) continue;

    const popForState = regionalProportionForState(region, row.candidates, regionPop);
    const camp = normalize(
      row.candidates.map((c) => ({ id: c.id, w: Math.max(0, c.campaignPoints) })),
    );

    const scores = finalize(row.candidates, camp, popForState);
    const winnerId = topEntry(scores);
    stateResults[row.state] = { winnerId, scores };
  }

  return stateResults;
}

function aggregateRegionalShares(regional: RegionalVote[]) {
  const out: Record<UsRegion, Record<string, number>> = {
    northeast_midwest: {},
    south: {},
    west: {},
  };
  for (const r of regional) {
    out[r.region] = { ...out[r.region], ...r.votesByCandidate };
  }
  const normalized: Record<UsRegion, Record<string, number>> = {
    northeast_midwest: {},
    south: {},
    west: {},
  };
  (Object.keys(out) as UsRegion[]).forEach((region) => {
    const tally = out[region];
    const ids = Object.keys(tally);
    const total = ids.reduce((s, id) => s + Math.max(0, tally[id] ?? 0), 0);
    if (total <= 0) {
      normalized[region] = {};
      return;
    }
    ids.forEach((id) => {
      normalized[region][id] = Math.max(0, tally[id] ?? 0) / total;
    });
  });
  return normalized;
}

function regionalProportionForState(
  region: UsRegion,
  candidates: CandidateInput[],
  regionPop: Record<UsRegion, Record<string, number>>,
) {
  const shares = regionPop[region] ?? {};
  const map: CommunityTally = {};
  for (const c of candidates) {
    map[c.id] = shares[c.id] ?? 0;
  }
  return map;
}

function normalize(weights: { id: string; w: number }[]) {
  const total = weights.reduce((s, x) => s + x.w, 0);
  if (total <= 0) {
    const eq = weights.length ? 1 / weights.length : 0;
    return Object.fromEntries(weights.map((x) => [x.id, eq]));
  }
  return Object.fromEntries(weights.map((x) => [x.id, x.w / total]));
}

function finalize(
  candidates: CandidateInput[],
  campaignShare: Record<string, number>,
  popularShare: Record<string, number>,
) {
  const scores: Record<string, number> = {};
  for (const c of candidates) {
    const cs = campaignShare[c.id] ?? 0;
    const ps = popularShare[c.id] ?? 0;
    scores[c.id] =
      ELECTION_WEIGHTS.campaign * cs + ELECTION_WEIGHTS.community * ps;
  }
  return scores;
}

function topEntry(scores: Record<string, number>) {
  let best: string | undefined;
  let bestV = -Infinity;
  for (const [id, v] of Object.entries(scores)) {
    if (v > bestV) {
      bestV = v;
      best = id;
    }
  }
  return best;
}
