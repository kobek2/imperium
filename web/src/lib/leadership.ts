/**
 * Shared helpers for leadership elections.
 *
 * Leadership elections are run as a single admin-toggled session per chamber. During the
 * 24h window members of that chamber can both file to run AND vote on each role. Winners
 * are decided by plurality; ties break on seniority (earliest representative/senator role
 * grant). Winning grants the leadership role_key without revoking the winner's chamber
 * role. See migration `20260428000000_leadership_sessions.sql`.
 *
 * Which caucus is "majority" when a session opens is inferred from seat counts in
 * `inferMajorityParty` (leadership-sessions): ties on seats break by chamber seniority
 * depth (same grant-based rule as leadership races), then by the seated President's party
 * as a stand-in for White House / VP tiebreak.
 *
 * Older machinery that used a leadership_role column on `public.elections` is deprecated
 * and no longer surfaced in the admin UI, but the helpers stay here for reference.
 */

export const LEADERSHIP_ROLES = [
  "speaker",
  "house_majority_leader",
  "house_majority_whip",
  "house_minority_leader",
  "house_minority_whip",
  "senate_majority_leader",
  "senate_majority_whip",
  "senate_minority_leader",
  "senate_minority_whip",
  "president_pro_tempore",
] as const;

export type LeadershipRole = (typeof LEADERSHIP_ROLES)[number];

export type Chamber = "house" | "senate";
export type PartyKey = "democrat" | "republican" | "independent";

export function isLeadershipRole(value: string | null | undefined): value is LeadershipRole {
  if (!value) return false;
  return (LEADERSHIP_ROLES as readonly string[]).includes(value);
}

/** Chamber that a given leadership role belongs to. */
export function chamberForLeadershipRole(role: LeadershipRole): Chamber {
  if (role === "speaker") return "house";
  if (role.startsWith("house_")) return "house";
  return "senate";
}

/** Chamber role_key that a leadership candidate/voter must already hold. */
export function requiredChamberRoleKey(role: LeadershipRole): "representative" | "senator" {
  return chamberForLeadershipRole(role) === "house" ? "representative" : "senator";
}

export function chamberRoleKey(chamber: Chamber): "representative" | "senator" {
  return chamber === "house" ? "representative" : "senator";
}

/** Pretty label for a leadership role. */
export function leadershipRoleLabel(role: LeadershipRole): string {
  return {
    speaker: "Speaker of the House",
    house_majority_leader: "House Majority Leader",
    house_majority_whip: "House Majority Whip",
    house_minority_leader: "House Minority Leader",
    house_minority_whip: "House Minority Whip",
    senate_majority_leader: "Senate Majority Leader",
    senate_majority_whip: "Senate Majority Whip",
    senate_minority_leader: "Senate Minority Leader",
    senate_minority_whip: "Senate Minority Whip",
    president_pro_tempore: "President Pro Tempore",
  }[role];
}

/** Short label used inside a chamber-scoped UI. */
export function leadershipRoleShortLabel(role: LeadershipRole): string {
  return {
    speaker: "Speaker",
    house_majority_leader: "Majority Leader",
    house_majority_whip: "Majority Whip",
    house_minority_leader: "Minority Leader",
    house_minority_whip: "Minority Whip",
    senate_majority_leader: "Majority Leader",
    senate_majority_whip: "Majority Whip",
    senate_minority_leader: "Minority Leader",
    senate_minority_whip: "Minority Whip",
    president_pro_tempore: "President Pro Tempore",
  }[role];
}

/** Roles voted on in a given chamber, in display order. */
export function leadershipRolesForChamber(chamber: Chamber): LeadershipRole[] {
  if (chamber === "house") {
    return [
      "speaker",
      "house_majority_leader",
      "house_majority_whip",
      "house_minority_leader",
      "house_minority_whip",
    ];
  }
  return [
    "president_pro_tempore",
    "senate_majority_leader",
    "senate_majority_whip",
    "senate_minority_leader",
    "senate_minority_whip",
  ];
}

/**
 * Speaker and the Senate PPT are elected by the entire chamber. Every other leadership role
 * is a partisan caucus election.
 */
export function isPartisanLeadershipRole(role: LeadershipRole): boolean {
  return role !== "speaker" && role !== "president_pro_tempore";
}

export function isMajorityLeadershipRole(role: LeadershipRole): boolean {
  return role === "house_majority_leader"
    || role === "house_majority_whip"
    || role === "senate_majority_leader"
    || role === "senate_majority_whip";
}

export function isMinorityLeadershipRole(role: LeadershipRole): boolean {
  return role === "house_minority_leader"
    || role === "house_minority_whip"
    || role === "senate_minority_leader"
    || role === "senate_minority_whip";
}

/**
 * Returns true if a chamber member with the given party can participate in a given
 * leadership role's vote/filing, given the session's captured majority_party.
 */
export function canParticipateInRole(
  role: LeadershipRole,
  memberParty: PartyKey | null,
  majorityParty: PartyKey,
): boolean {
  if (!isPartisanLeadershipRole(role)) return true;
  if (!memberParty) return false;
  const isMajorityMember = memberParty === majorityParty;
  if (isMajorityLeadershipRole(role)) return isMajorityMember;
  if (isMinorityLeadershipRole(role)) return !isMajorityMember;
  return false;
}
