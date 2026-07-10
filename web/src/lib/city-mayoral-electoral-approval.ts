/**
 * Mayoral electoral mandate — ward population × signed election margin × decay.
 * Recomputed yearly (budget cycle), not every tick.
 */

import { NYC_COUNCIL_DISTRICTS } from "@/lib/city";
import { CAMPAIGN_CYCLE_TURNS } from "@/lib/campaign-day-cycle";

/** Approximate share of city population per council district (sums to 1). */
export const WARD_POPULATION_SHARE: Record<string, number> = Object.fromEntries(
  NYC_COUNCIL_DISTRICTS.map((d, i) => {
    const base = 1 / NYC_COUNCIL_DISTRICTS.length;
    const pviBias = Math.abs(d.pvi) / 200;
    return [d.code, base + (i % 2 === 0 ? pviBias : -pviBias * 0.5)];
  }),
);

// Renormalize shares to sum to 1.
const SHARE_SUM = Object.values(WARD_POPULATION_SHARE).reduce((a, b) => a + b, 0);
for (const code of Object.keys(WARD_POPULATION_SHARE)) {
  WARD_POPULATION_SHARE[code] /= SHARE_SUM;
}

/** Halving relevance every full campaign cycle (15 ticks). */
export const ELECTION_DECAY_HALF_LIFE_TICKS = CAMPAIGN_CYCLE_TURNS;

export type WardElectoralInput = {
  wardCode: string;
  /** Signed margin for/against mayor: -1 (hostile) to +1 (strong mandate). */
  signedMargin: number;
  /** Sim ticks since that ward's last election closed. */
  ticksSinceElection: number;
  populationShare?: number;
};

export function electionDecayWeight(ticksSinceElection: number): number {
  if (ticksSinceElection <= 0) return 1;
  return Math.pow(0.5, ticksSinceElection / ELECTION_DECAY_HALF_LIFE_TICKS);
}

function clampApproval(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * approval_for_mayor = Σ (ward_pop × signed_margin × decay) / Σ (ward_pop × decay)
 * mapped to 0–100 where 0 = full rejection, 50 = even, 100 = unanimous mandate.
 */
export function computeMayoralElectoralApproval(
  wards: WardElectoralInput[],
  cityPopulation: number,
): number {
  if (!wards.length || cityPopulation <= 0) return 50;

  let weightedMargin = 0;
  let weightSum = 0;

  for (const ward of wards) {
    const share = ward.populationShare ?? WARD_POPULATION_SHARE[ward.wardCode.toUpperCase()] ?? 1 / wards.length;
    const pop = cityPopulation * share;
    const decay = electionDecayWeight(ward.ticksSinceElection);
    const w = pop * decay;
    weightedMargin += w * ward.signedMargin;
    weightSum += w;
  }

  if (weightSum <= 0) return 50;
  const normalized = weightedMargin / weightSum;
  return clampApproval(50 + normalized * 50);
}

/** Convert winner vote share + party alignment into signed margin for mayor. */
export function signedMarginForMayor(
  winnerParty: string,
  mayorParty: string,
  winnerVoteShare: number,
): number {
  const share = Math.max(0.5, Math.min(1, winnerVoteShare));
  const strength = (share - 0.5) * 2;
  const aligned =
    winnerParty.toLowerCase() === mayorParty.toLowerCase() ||
    (winnerParty === "democrat" && mayorParty === "democrat") ||
    (winnerParty === "republican" && mayorParty === "republican");
  return aligned ? strength : -strength;
}
