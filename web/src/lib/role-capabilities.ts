/**
 * Permission bundles derived from your server's role ladder.
 * Adjust sets here if your chamber rules differ.
 */

const FLOOR_SCHEDULERS = new Set([
  "admin",
  "speaker",
  "house_deputy",
  "house_majority_leader",
  "house_majority_whip",
  "senate_majority_leader",
  "senate_deputy",
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

/** Accept/reject bills in the hopper for the House — Speaker, Deputy (plus admin). */
const HOUSE_HOPPER_ACCEPT_REJECT = new Set(["admin", "speaker", "house_deputy"]);

/** Accept/reject bills in the hopper for the Senate — Majority Leader, Deputy (plus admin). */
const SENATE_HOPPER_ACCEPT_REJECT = new Set(["admin", "senate_majority_leader", "senate_deputy"]);

/** Whether this user may accept or reject hopper bills for the given originating chamber. */
export function canAcceptRejectHopperForChamber(roleKeys: string[], chamber: "house" | "senate"): boolean {
  const set = chamber === "house" ? HOUSE_HOPPER_ACCEPT_REJECT : SENATE_HOPPER_ACCEPT_REJECT;
  return roleKeys.some((k) => set.has(k));
}

const HOUSE_LEADER_ONLY = new Set(["admin", "speaker"]);
const SENATE_LEADER_ONLY = new Set(["admin", "senate_majority_leader"]);
const HOUSE_LEADER_OR_DEPUTY = new Set(["admin", "speaker", "house_deputy"]);
const SENATE_LEADER_OR_DEPUTY = new Set(["admin", "senate_majority_leader", "senate_deputy"]);

/**
 * `leadership_review`: first 12h speaker/ML only; next 12h speaker/ML + deputy (first action wins).
 * Legacy `submitted` hopper keeps Speaker/Deputy behaviour.
 */
export function canActLeadershipReviewHopper(
  roleKeys: string[],
  chamber: "house" | "senate",
  bill: {
    status: string;
    leadership_primary_deadline?: string | null;
    leadership_deputy_deadline?: string | null;
  },
  nowMs: number = Date.now(),
): boolean {
  if (bill.status === "submitted") return canAcceptRejectHopperForChamber(roleKeys, chamber);
  if (bill.status !== "leadership_review") return false;

  const p = bill.leadership_primary_deadline ? new Date(bill.leadership_primary_deadline).getTime() : null;
  const d = bill.leadership_deputy_deadline ? new Date(bill.leadership_deputy_deadline).getTime() : null;
  if (p == null || Number.isNaN(p) || d == null || Number.isNaN(d)) {
    return canAcceptRejectHopperForChamber(roleKeys, chamber);
  }

  if (nowMs < p) {
    return roleKeys.some((k) => (chamber === "house" ? HOUSE_LEADER_ONLY : SENATE_LEADER_ONLY).has(k));
  }
  if (nowMs < d) {
    return roleKeys.some((k) => (chamber === "house" ? HOUSE_LEADER_OR_DEPUTY : SENATE_LEADER_OR_DEPUTY).has(k));
  }
  return false;
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
