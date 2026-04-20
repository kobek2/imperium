"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/is-admin";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import {
  canParticipateInRole,
  chamberRoleKey,
  isLeadershipRole,
  isPartisanLeadershipRole,
  leadershipRolesForChamber,
  type Chamber,
  type LeadershipRole,
  type PartyKey,
} from "@/lib/leadership";

const SESSION_DURATION_HOURS = 24;

const MAJORITY_PARTIES: PartyKey[] = ["democrat", "republican", "independent"];

/**
 * Detects the schema-cache / missing-relation errors PostgREST throws when the leadership
 * session tables haven't been migrated into the target database yet. Matching is loose on
 * purpose because the exact wording drifts between PostgREST / Postgres versions.
 */
function isMissingLeadershipSchema(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("leadership_sessions") ||
    m.includes("leadership_session_candidates") ||
    m.includes("leadership_session_votes") ||
    m.includes("close_leadership_session") ||
    m.includes("advance_leadership_sessions_by_schedule")
  );
}

const LEADERSHIP_MIGRATION_HINT =
  "Leadership sessions aren't set up on this database yet. Run supabase/migrations/20260428000000_leadership_sessions.sql in the Supabase SQL editor, then `notify pgrst, 'reload schema';`.";

function assertChamber(value: unknown): Chamber {
  if (value !== "house" && value !== "senate") {
    throw new Error("Chamber must be 'house' or 'senate'.");
  }
  return value;
}

function assertParty(value: string | null): PartyKey | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v === "democrat" || v === "republican" || v === "independent") return v;
  return null;
}

function revalidateSession(sessionId: string) {
  revalidatePath("/congress");
  revalidatePath("/congress/house");
  revalidatePath("/congress/senate");
  revalidatePath("/congress/leadership");
  revalidatePath(`/congress/leadership/session/${sessionId}`);
  revalidatePath("/admin/elections");
  revalidatePath("/directory");
}

/**
 * Party that "controls the White House" for tie purposes: the seated President's party
 * (from `government_role_grants` + profile). No president or unknown party → null.
 */
async function inferControllingExecutiveParty(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<PartyKey | null> {
  const { data: grant } = await supabase
    .from("government_role_grants")
    .select("user_id")
    .eq("role_key", "president")
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!grant?.user_id) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("party")
    .eq("id", grant.user_id)
    .maybeSingle();
  return assertParty(profile?.party ?? null);
}

/**
 * Among parties tied on seat count, prefer the delegation whose seniority multiset wins:
 * compare earliest chamber-role grant, then second-earliest, etc. (same spirit as
 * `close_leadership_session`). Returns null only if every tied party has an identical
 * multiset (including empty), so callers can fall back to White House party.
 */
function pickPartyBySeniorityMultiset(
  leaders: PartyKey[],
  seniorityByParty: Record<PartyKey, number[]>,
): PartyKey | null {
  const lists = Object.fromEntries(
    leaders.map((p) => [p, [...seniorityByParty[p]].sort((a, b) => a - b)]),
  ) as Record<PartyKey, number[]>;

  let survivors = [...leaders];
  while (survivors.length > 1) {
    const heads = survivors
      .map((p) => lists[p][0])
      .filter((t): t is number => t !== undefined);
    if (!heads.length) return null;
    const minHead = Math.min(...heads);
    const withMin = survivors.filter((p) => lists[p][0] === minHead);
    if (withMin.length === survivors.length) {
      for (const p of survivors) lists[p].shift();
      if (survivors.every((p) => lists[p].length === 0)) return null;
      continue;
    }
    survivors = withMin;
  }
  return survivors[0] ?? null;
}

/**
 * Determine which party holds the majority of the given chamber right now. Used at session
 * creation to lock in majority / minority caucus membership for the duration of the vote.
 *
 * Rules: highest seat count (members with a chamber grant and a known party). Ties on
 * count break by seniority depth (earliest `granted_at` on that chamber role, then peel
 * matching heads until one party is strictly more senior). If still tied, the seated
 * President's party wins (White House / VP analogue). Empty chamber → democrat.
 */
async function inferMajorityParty(
  supabase: Awaited<ReturnType<typeof createClient>>,
  chamber: Chamber,
): Promise<PartyKey> {
  const key = chamberRoleKey(chamber);
  const { data: grants } = await supabase
    .from("government_role_grants")
    .select("user_id, granted_at")
    .eq("role_key", key);

  const firstGrantMs = new Map<string, number>();
  for (const g of grants ?? []) {
    const t = new Date(g.granted_at).getTime();
    const cur = firstGrantMs.get(g.user_id);
    if (cur === undefined || t < cur) firstGrantMs.set(g.user_id, t);
  }

  const ids = [...firstGrantMs.keys()];
  if (!ids.length) return "democrat";

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, party")
    .in("id", ids);

  const counts: Record<PartyKey, number> = { democrat: 0, republican: 0, independent: 0 };
  const seniorityByParty: Record<PartyKey, number[]> = {
    democrat: [],
    republican: [],
    independent: [],
  };

  for (const p of profiles ?? []) {
    const party = assertParty(p.party);
    if (!party) continue;
    const grantedMs = firstGrantMs.get(p.id);
    if (grantedMs === undefined) continue;
    counts[party]++;
    seniorityByParty[party].push(grantedMs);
  }

  const max = Math.max(counts.democrat, counts.republican, counts.independent);
  if (max <= 0) return "democrat";

  const leaders = MAJORITY_PARTIES.filter((pk) => counts[pk] === max);
  if (leaders.length === 1) return leaders[0]!;

  const seniorityPick = pickPartyBySeniorityMultiset(leaders, seniorityByParty);
  if (seniorityPick) return seniorityPick;

  const whiteHouse = await inferControllingExecutiveParty(supabase);
  if (whiteHouse && leaders.includes(whiteHouse)) return whiteHouse;

  return [...leaders].sort()[0]!;
}

/** Admin: open a new 24-hour leadership session for a chamber. */
export async function startLeadershipSession(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const chamber = assertChamber(String(formData.get("chamber") ?? ""));

  const existingRes = await supabase
    .from("leadership_sessions")
    .select("id")
    .eq("chamber", chamber)
    .eq("phase", "open")
    .maybeSingle();
  if (existingRes.error && isMissingLeadershipSchema(existingRes.error.message)) {
    throw new Error(LEADERSHIP_MIGRATION_HINT);
  }
  if (existingRes.data) {
    throw new Error(`A ${chamber} leadership session is already open.`);
  }

  const majorityParty = await inferMajorityParty(supabase, chamber);
  const closesAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();

  const { data: inserted, error } = await supabase
    .from("leadership_sessions")
    .insert({
      chamber,
      phase: "open",
      majority_party: majorityParty,
      closes_at: closesAt,
    })
    .select("id")
    .single();
  if (error) {
    if (isMissingLeadershipSchema(error.message)) {
      throw new Error(LEADERSHIP_MIGRATION_HINT);
    }
    throw new Error(error.message);
  }

  if (inserted) revalidateSession(inserted.id);
}

/** Admin: manually close a session early. Winners are resolved at close time. */
export async function closeLeadershipSessionNow(formData: FormData): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const sessionId = String(formData.get("session_id") ?? "");
  if (!sessionId) throw new Error("Missing session_id.");

  const { error } = await supabase.rpc("close_leadership_session", { s_id: sessionId });
  if (error) {
    if (isMissingLeadershipSchema(error.message)) {
      throw new Error(LEADERSHIP_MIGRATION_HINT);
    }
    throw new Error(error.message);
  }

  revalidateSession(sessionId);
}

async function loadSessionOrThrow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionId: string,
) {
  const { data, error } = await supabase
    .from("leadership_sessions")
    .select("id, chamber, phase, majority_party, closes_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) {
    if (isMissingLeadershipSchema(error.message)) {
      throw new Error(LEADERSHIP_MIGRATION_HINT);
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error("Leadership session not found.");
  return data as {
    id: string;
    chamber: Chamber;
    phase: "open" | "closed";
    majority_party: PartyKey;
    closes_at: string;
  };
}

async function requireEligibleMember(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  chamber: Chamber,
): Promise<{ party: PartyKey | null }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role, party")
    .eq("id", userId)
    .maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, userId, profile ?? null);
  const needed = chamberRoleKey(chamber);
  if (!roleKeys.includes(needed)) {
    const label = chamber === "house" ? "representatives" : "senators";
    throw new Error(`Only sitting ${label} may participate in this leadership session.`);
  }
  return { party: assertParty(profile?.party ?? null) };
}

/** File (or switch) candidacy for one role inside a session. */
export async function fileLeadershipCandidacy(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized.");

  const sessionId = String(formData.get("session_id") ?? "");
  const roleRaw = String(formData.get("role") ?? "");
  if (!isLeadershipRole(roleRaw)) throw new Error("Invalid leadership role.");
  const role: LeadershipRole = roleRaw;

  const session = await loadSessionOrThrow(supabase, sessionId);
  if (session.phase !== "open") throw new Error("This session is closed.");
  if (new Date(session.closes_at).getTime() < Date.now()) {
    throw new Error("This session's window has already elapsed.");
  }

  const roleChamber = leadershipRolesForChamber(session.chamber).includes(role);
  if (!roleChamber) {
    throw new Error("That role isn't on this chamber's ballot.");
  }

  const { party } = await requireEligibleMember(supabase, user.id, session.chamber);

  if (isPartisanLeadershipRole(role) && !canParticipateInRole(role, party, session.majority_party)) {
    throw new Error(
      `This caucus race is restricted — your party doesn't match the ${
        role.includes("majority") ? "majority" : "minority"
      } caucus.`,
    );
  }

  // Remove any prior filing this user has in this session, then insert the new one.
  // "One filing per user per session" means switching roles withdraws the old one.
  await supabase
    .from("leadership_session_candidates")
    .delete()
    .eq("session_id", sessionId)
    .eq("user_id", user.id);

  const { error } = await supabase
    .from("leadership_session_candidates")
    .insert({ session_id: sessionId, user_id: user.id, role });
  if (error) throw new Error(error.message);

  revalidateSession(sessionId);
}

/** Withdraw this user's candidacy from the session. */
export async function withdrawLeadershipCandidacy(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized.");

  const sessionId = String(formData.get("session_id") ?? "");
  const session = await loadSessionOrThrow(supabase, sessionId);
  if (session.phase !== "open") throw new Error("This session is closed.");

  await supabase
    .from("leadership_session_candidates")
    .delete()
    .eq("session_id", sessionId)
    .eq("user_id", user.id);

  revalidateSession(sessionId);
}

/** Cast (or change, or retract) a vote for a specific role in the session. */
export async function castLeadershipVote(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized.");

  const sessionId = String(formData.get("session_id") ?? "");
  const roleRaw = String(formData.get("role") ?? "");
  if (!isLeadershipRole(roleRaw)) throw new Error("Invalid leadership role.");
  const role: LeadershipRole = roleRaw;
  const candidateIdRaw = String(formData.get("candidate_id") ?? "");
  const candidateId = candidateIdRaw === "" ? null : candidateIdRaw;

  const session = await loadSessionOrThrow(supabase, sessionId);
  if (session.phase !== "open") throw new Error("This session is closed.");
  if (new Date(session.closes_at).getTime() < Date.now()) {
    throw new Error("This session's window has already elapsed.");
  }

  if (!leadershipRolesForChamber(session.chamber).includes(role)) {
    throw new Error("That role isn't on this chamber's ballot.");
  }

  const { party } = await requireEligibleMember(supabase, user.id, session.chamber);
  if (isPartisanLeadershipRole(role) && !canParticipateInRole(role, party, session.majority_party)) {
    throw new Error(
      `You can't vote in this caucus race — restricted to the ${
        role.includes("majority") ? "majority" : "minority"
      } party.`,
    );
  }

  // Always clear any prior vote for this (session, role, voter).
  await supabase
    .from("leadership_session_votes")
    .delete()
    .eq("session_id", sessionId)
    .eq("role", role)
    .eq("voter_id", user.id);

  if (candidateId) {
    const { data: cand, error: candErr } = await supabase
      .from("leadership_session_candidates")
      .select("id, session_id, role")
      .eq("id", candidateId)
      .maybeSingle();
    if (candErr) throw new Error(candErr.message);
    if (!cand || cand.session_id !== sessionId || cand.role !== role) {
      throw new Error("That candidate isn't running for this role.");
    }
    const { error: insErr } = await supabase
      .from("leadership_session_votes")
      .insert({
        session_id: sessionId,
        role,
        voter_id: user.id,
        candidate_id: candidateId,
      });
    if (insErr) throw new Error(insErr.message);
  }

  revalidateSession(sessionId);
}
