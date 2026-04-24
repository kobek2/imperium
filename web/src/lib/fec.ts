/**
 * Campaign activity caps and endorsement weights.
 * Admins can log activity in the dashboard; these constants drive validation and totals.
 */

export const CAMPAIGN_ACTIVITY = {
  speech: { points: 20, maxPerDay: 7 },
  poster: { points: 15, maxPerDay: 5 },
  website: { points: 30, oneTime: true },
} as const;

/** General-election style endorsements (first list in your FEC doc). */
export const GENERAL_ENDORSEMENT_POINTS = {
  citizen: 10,
  former_president: 20,
  representative: 20,
  senator: 25,
  congressional_leadership_bonus: 10,
  governor: 25,
  vice_president: 30,
  president: 35,
} as const;

/** Presidential endorsement pool (second list) — points received, then allocated to states (≤45/state in app). */
export const PRESIDENTIAL_ENDORSEMENT_POINTS = {
  current_president: 35,
  current_vice_president: 30,
  former_president: 26,
  former_vice_president: 22,
  current_senate_leadership: 18,
  current_senator: 14,
  current_house_leadership: 12,
  current_representative: 10,
  former_senate_leadership: 8,
  former_senator: 6,
  former_house_leadership: 6,
  former_representative: 3,
} as const;

export const PRESIDENTIAL_STATE_ENDORSEMENT_CAP = 45;

export const ELECTION_WEIGHTS = {
  campaign: 0.6,
  community: 0.4,
} as const;

/** Partisan lean points applied to campaign score (positive helps Democrats, negative helps Republicans). */
export function districtLeanBonus(
  pvi: number,
  candidateParty: "democrat" | "republican",
): number {
  if (candidateParty === "democrat") return pvi;
  return -pvi;
}

const G = GENERAL_ENDORSEMENT_POINTS;
const bonus = G.congressional_leadership_bonus;

/** Best general-election endorsement weight implied by the user's effective role keys. */
export function endorsementPointsForRoles(roleKeys: string[]): number {
  const map: Record<string, number> = {
    president: G.president,
    vice_president: G.vice_president,
    governor: G.governor,
    senator: G.senator,
    representative: G.representative,
    former_president: G.former_president,
    citizen: G.citizen,
    speaker: G.representative + bonus,
    president_pro_tempore: G.senator + bonus,
    senate_majority_leader: G.senator + bonus,
    senate_minority_leader: G.senator + bonus,
    // Whips count as chamber members for endorsement weight; they do not get
    // the extra leadership bonus.
    senate_majority_whip: G.senator,
    senate_minority_whip: G.senator,
    house_majority_leader: G.representative + bonus,
    house_minority_leader: G.representative + bonus,
    house_majority_whip: G.representative,
    house_minority_whip: G.representative,
  };
  let max = 0;
  for (const k of roleKeys) {
    const p = map[k] ?? 0;
    if (p > max) max = p;
  }
  return max;
}
