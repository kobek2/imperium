/**
 * Permission bundles derived from your server's role ladder.
 * Adjust sets here if your chamber rules differ.
 */

const FLOOR_SCHEDULERS = new Set([
  "admin",
  "speaker",
  "house_majority_leader",
  "house_majority_whip",
  "senate_majority_leader",
  "senate_majority_whip",
  "president_pro_tempore",
]);

const PRESIDENT_OFFICE = new Set(["admin", "president"]);

const VP_TIE = new Set(["admin", "vice_president"]);

export function mergeRoleKeys(
  grantKeys: string[] | null | undefined,
  legacyOfficeRole: string | null | undefined,
): string[] {
  const out = new Set<string>();
  for (const k of grantKeys ?? []) {
    if (k) out.add(k);
  }
  if (legacyOfficeRole) out.add(legacyOfficeRole);
  return [...out];
}

export function canAdvanceLegislation(roleKeys: string[]): boolean {
  return roleKeys.some((k) => FLOOR_SCHEDULERS.has(k));
}

export function canActAsPresident(roleKeys: string[]): boolean {
  return roleKeys.some((k) => PRESIDENT_OFFICE.has(k));
}

export function canCastSenateTiebreaker(roleKeys: string[]): boolean {
  return roleKeys.some((k) => VP_TIE.has(k));
}

export function isPartyDemocrat(roleKeys: string[]): boolean {
  return roleKeys.includes("party_democrat");
}

export function isPartyRepublican(roleKeys: string[]): boolean {
  return roleKeys.includes("party_republican");
}

/** Accept/reject bills in the hopper for the House — Speaker only (plus admin). */
const HOUSE_HOPPER_ACCEPT_REJECT = new Set(["admin", "speaker"]);

/** Accept/reject bills in the hopper for the Senate — Majority Leader only (plus admin). */
const SENATE_HOPPER_ACCEPT_REJECT = new Set(["admin", "senate_majority_leader"]);

/** Whether this user may accept or reject hopper bills for the given originating chamber. */
export function canAcceptRejectHopperForChamber(roleKeys: string[], chamber: "house" | "senate"): boolean {
  const set = chamber === "house" ? HOUSE_HOPPER_ACCEPT_REJECT : SENATE_HOPPER_ACCEPT_REJECT;
  return roleKeys.some((k) => set.has(k));
}

/** Alias for {@link canAcceptRejectHopperForChamber}. */
export function canReviewLeadershipForChamber(roleKeys: string[], chamber: "house" | "senate"): boolean {
  return canAcceptRejectHopperForChamber(roleKeys, chamber);
}

export function canReviewAnyChamberLeadership(roleKeys: string[]): boolean {
  return canAcceptRejectHopperForChamber(roleKeys, "house") || canAcceptRejectHopperForChamber(roleKeys, "senate");
}

/** Speaker / Senate Majority Leader (and admin) may edit filed bills for that chamber. */
export function canLeadershipEditBillContent(roleKeys: string[], chamber: "house" | "senate"): boolean {
  return canAcceptRejectHopperForChamber(roleKeys, chamber);
}
