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

const HOUSE_LEADERSHIP_REVIEW = new Set([
  "admin",
  "speaker",
  "house_majority_leader",
  "house_majority_whip",
]);

const SENATE_LEADERSHIP_REVIEW = new Set([
  "admin",
  "senate_majority_leader",
  "senate_majority_whip",
  "president_pro_tempore",
]);

export function canReviewLeadershipForChamber(roleKeys: string[], chamber: "house" | "senate"): boolean {
  const set = chamber === "house" ? HOUSE_LEADERSHIP_REVIEW : SENATE_LEADERSHIP_REVIEW;
  return roleKeys.some((k) => set.has(k));
}

export function canReviewAnyChamberLeadership(roleKeys: string[]): boolean {
  return canReviewLeadershipForChamber(roleKeys, "house") || canReviewLeadershipForChamber(roleKeys, "senate");
}
