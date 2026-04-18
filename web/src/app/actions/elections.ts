"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/is-admin";
import { districtLeanBonus, endorsementPointsForRoles } from "@/lib/fec";
import { scoreGeneralElection, type Party } from "@/lib/election-engine";
import {
  candidacyPartyFromProfile,
  getFilingEligibilityMessage,
  loadActiveCandidacySlots,
} from "@/lib/election-filing";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import {
  chamberForLeadershipRole,
  isLeadershipRole,
  isPartisanLeadershipRole,
  type LeadershipRole,
  requiredChamberRoleKey,
} from "@/lib/leadership";
import { countWords } from "@/lib/word-count";

type ElectionPhase = "filing" | "primary" | "general" | "closed";

function parseLocalDateTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date/time");
  return d.toISOString();
}

export async function createElection(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();

  // A leadership_role value switches the entire race into "leadership election" mode:
  // no geography, no primary, plain plurality. See lib/leadership.ts + the SQL migration
  // 20260427000000 for the matching behaviour on the database side.
  const leadership_role_raw = String(formData.get("leadership_role") ?? "").trim();
  const leadership_role: LeadershipRole | null = isLeadershipRole(leadership_role_raw)
    ? leadership_role_raw
    : null;

  const office = String(formData.get("office") ?? "").trim() as "house" | "senate" | "president";
  const state = String(formData.get("state") ?? "").trim().toUpperCase() || null;
  const district_code = String(formData.get("district_code") ?? "").trim() || null;
  const senate_class_raw = String(formData.get("senate_class") ?? "").trim();
  const senate_class = senate_class_raw ? Number(senate_class_raw) : null;

  const filing_opens_at = parseLocalDateTime(String(formData.get("filing_opens_at")));
  const filing_closes_at = parseLocalDateTime(String(formData.get("filing_closes_at")));
  const general_closes_at = parseLocalDateTime(String(formData.get("general_closes_at")));

  if (filing_closes_at < filing_opens_at) throw new Error("Filing must end after it opens.");

  let primary_closes_at: string | null = null;
  let primary_party_wide = true;
  let restricted_party: "democrat" | "republican" | "independent" | null = null;

  if (leadership_role) {
    // Leadership races skip primaries entirely — we go straight from filing to general.
    if (general_closes_at < filing_closes_at) {
      throw new Error("General must end after filing.");
    }
    const chamber = chamberForLeadershipRole(leadership_role);
    if (chamber !== "house" && chamber !== "senate") {
      throw new Error("Unknown leadership chamber.");
    }

    if (isPartisanLeadershipRole(leadership_role)) {
      const restricted = String(formData.get("restricted_party") ?? "").trim().toLowerCase();
      if (restricted !== "democrat" && restricted !== "republican" && restricted !== "independent") {
        throw new Error(
          "Partisan leadership races (majority / minority leader / whip) require a restricted party.",
        );
      }
      restricted_party = restricted;
    }

    const row = {
      office: chamber,
      state: null,
      district_code: null,
      senate_class: null,
      phase: "filing" as ElectionPhase,
      filing_opens_at,
      filing_closes_at,
      primary_closes_at: null,
      general_closes_at,
      primary_party_wide: true,
      leadership_role,
      restricted_party,
    };
    const { error } = await supabase.from("elections").insert(row);
    if (error) throw new Error(error.message);
    revalidatePath("/admin/elections");
    revalidatePath("/elections");
    return;
  }

  const primary_closes_at_raw = String(formData.get("primary_closes_at") ?? "").trim();
  if (!primary_closes_at_raw) throw new Error("Primary close time is required for seat races.");
  primary_closes_at = parseLocalDateTime(primary_closes_at_raw);
  if (primary_closes_at < filing_closes_at) throw new Error("Primary must end after filing.");
  if (general_closes_at < primary_closes_at) throw new Error("General must end after primary.");

  if (office === "house") {
    if (!state || state.length !== 2) throw new Error("House races need a two-letter state.");
    if (!district_code) throw new Error("House races need a district code (e.g. CA-12).");
  } else if (office === "senate") {
    if (!state || state.length !== 2) throw new Error("Senate races need a two-letter state.");
    if (!senate_class || senate_class < 1 || senate_class > 3) {
      throw new Error("Senate races need class 1, 2, or 3.");
    }
  } else if (office === "president") {
    /* ok */
  } else {
    throw new Error("Invalid office.");
  }

  const primary_ballot_scope = String(formData.get("primary_ballot_scope") ?? "party_wide").trim();
  primary_party_wide = primary_ballot_scope !== "jurisdiction_only";
  if (office === "president") {
    primary_party_wide = true;
  }

  const row = {
    office,
    state: office === "president" ? null : state,
    district_code: office === "house" ? district_code : null,
    senate_class: office === "senate" ? senate_class : null,
    phase: "filing" as ElectionPhase,
    filing_opens_at,
    filing_closes_at,
    primary_closes_at,
    general_closes_at,
    primary_party_wide,
    leadership_role: null,
    restricted_party: null,
  };

  const { error } = await supabase.from("elections").insert(row);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/elections");
  revalidatePath("/elections");
}

export async function updateElectionPrimaryBallot(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const election_id = String(formData.get("election_id"));
  const primary_ballot_scope = String(formData.get("primary_ballot_scope") ?? "party_wide").trim();
  const { data: meta } = await supabase
    .from("elections")
    .select("office")
    .eq("id", election_id)
    .maybeSingle();

  let primary_party_wide = primary_ballot_scope !== "jurisdiction_only";
  if (meta?.office === "president") {
    primary_party_wide = true;
  }

  const { error } = await supabase
    .from("elections")
    .update({ primary_party_wide })
    .eq("id", election_id);

  if (error) throw new Error(error.message);
  revalidatePath("/admin/elections");
  revalidatePath(`/admin/elections/${election_id}`);
  revalidatePath("/elections");
  revalidatePath(`/elections/${election_id}`);
}

/**
 * Admin phase override.
 *
 * Forward transitions run the full closeout for the phase we're leaving:
 *   filing  -> primary  : re-set primary_closes_at (from form), optionally pick a "who would win filing"
 *                         (no-op; filing has no votes).
 *   primary -> general  : pick primary winners per party (plurality, tiebreak by filing order).
 *   general -> closed   : finalize. House/Senate use the full FEC score; President uses plurality of
 *                         general votes. If every candidate has 0 votes, the first-filer wins.
 *
 * Backward transitions (e.g. closed -> general) just update the phase/end time and do not retract
 * winner_user_id or primary_winner flags — the admin can clear those manually by picking a new winner
 * or unsetting primary_winner in the candidate card if needed.
 *
 * end_at (optional): datetime-local string. When moving *into* a phase with a timer (primary/general),
 * we write it to the matching *_closes_at column so auto-advance doesn't immediately fire.
 */
export async function setElectionPhase(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("election_id"));
  const phase = String(formData.get("phase")) as ElectionPhase;
  if (!["filing", "primary", "general", "closed"].includes(phase)) {
    throw new Error("Invalid phase.");
  }
  const endAtRaw = String(formData.get("end_at") ?? "").trim();
  const endAtIso = endAtRaw ? parseLocalDateTime(endAtRaw) : null;

  const { data: current } = await supabase
    .from("elections")
    .select(
      "id, phase, office, state, district_code, filing_closes_at, primary_closes_at, general_closes_at, winner_user_id, leadership_role",
    )
    .eq("id", id)
    .maybeSingle();
  if (!current) throw new Error("Election not found.");

  // Leadership races have no primary phase — admins can't force one.
  if (current.leadership_role && phase === "primary") {
    throw new Error("Leadership races skip primaries. Move filing straight to general instead.");
  }

  const prevPhase = current.phase as ElectionPhase;
  const updates: Record<string, unknown> = { phase };

  // Attach the new end timestamp to whichever field the target phase drives.
  if (endAtIso) {
    if (phase === "filing") updates.filing_closes_at = endAtIso;
    else if (phase === "primary") updates.primary_closes_at = endAtIso;
    else if (phase === "general") updates.general_closes_at = endAtIso;
  }

  // Forward transition hooks: fill in vote-based winners for the phase we're leaving.
  const forwardFrom: Record<ElectionPhase, ElectionPhase[]> = {
    filing: ["primary", "general", "closed"],
    primary: ["general", "closed"],
    general: ["closed"],
    closed: [],
  };
  const isForward = forwardFrom[prevPhase].includes(phase);

  if (isForward && (phase === "general" || phase === "closed")) {
    // Ensure primary winners are flagged before moving out of filing/primary. Leadership
    // races skip the primary entirely so we don't run pickPrimaryWinners for them.
    if ((prevPhase === "filing" || prevPhase === "primary") && !current.leadership_role) {
      await pickPrimaryWinners(supabase, id);
    }
  }

  // Finalize general winner when moving into closed.
  if (isForward && phase === "closed") {
    const winnerUserId = await computeGeneralWinner(supabase, id, {
      office: current.office,
      district_code: current.district_code,
      state: current.state,
      leadership_role: current.leadership_role,
    });
    if (winnerUserId) {
      updates.winner_user_id = winnerUserId;
    }
  }

  const { error } = await supabase.from("elections").update(updates).eq("id", id);
  if (error) throw new Error(error.message);

  if (phase === "closed") {
    const { error: roleErr } = await supabase.rpc("apply_election_role_transitions", {
      e_election: id,
    });
    if (roleErr) {
      console.warn("[setElectionPhase] role transition warning:", roleErr.message);
    }
  }

  revalidatePath("/admin/elections");
  revalidatePath(`/admin/elections/${id}`);
  revalidatePath("/elections");
  revalidatePath(`/elections/${id}`);
}

type FilingCandidate = {
  id: string;
  user_id: string;
  party: string;
  campaign_points_total: number | null;
  primary_winner: boolean | null;
  created_at: string | null;
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

/**
 * Picks one nominee per party from primary_votes plurality.
 * Ties (including everyone-at-zero) resolve to the earliest filer, then lexicographically smallest id.
 * Idempotent — safe to call when some primary_winner flags are already set.
 */
async function pickPrimaryWinners(
  supabase: Awaited<ReturnType<typeof createClient>>,
  election_id: string,
) {
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
    if (error) throw new Error(error.message);
  }
}

/**
 * Resolve a general-election winner for admin-forced closes.
 * House / Senate:   full 60/40 FEC scoring (campaign pts + district PVI + community votes).
 * President:        plurality of general_votes (admin can still override via finalizePresident).
 * If nobody has any votes, the earliest filer wins. If zero candidates, returns null.
 */
async function computeGeneralWinner(
  supabase: Awaited<ReturnType<typeof createClient>>,
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
  const tally: Record<string, number> = {};
  for (const v of gv ?? []) {
    tally[v.candidate_id] = (tally[v.candidate_id] ?? 0) + 1;
  }

  // Leadership races + presidential races both short-circuit to plurality of general votes
  // (no PVI, no campaign points). Everyone-at-zero falls back to earliest filer.
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
    campaignPoints: Math.max(0, Number(c.campaign_points_total ?? 0)) + leanFor(c.party),
  }));

  const scores = scoreGeneralElection(inputs, tally);
  const ranked = sortByVotesThenFilingOrder(
    active.map((c) => ({
      ...c,
      _score: scores[c.id] ?? 0,
    })),
    Object.fromEntries(active.map((c) => [c.id, (scores[c.id] ?? 0) * 1_000_000])),
  );
  return ranked[0]!.user_id;
}

/** Manual primary closeout. Uses filing-order tiebreak so the earliest filer wins on ties (including 0-vote ties). */
export async function endPrimarySelectWinners(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const election_id = String(formData.get("election_id"));

  const { data: election } = await supabase
    .from("elections")
    .select("phase")
    .eq("id", election_id)
    .single();
  if (!election || election.phase !== "primary") {
    throw new Error(
      `End primary only works when the race is in the primary phase (current: ${election?.phase ?? "unknown"}). Use the Primary phase button first, then run this after primary votes.`,
    );
  }

  await pickPrimaryWinners(supabase, election_id);

  const { error: pe } = await supabase
    .from("elections")
    .update({ phase: "general" })
    .eq("id", election_id);
  if (pe) throw new Error(pe.message);

  revalidatePath("/admin/elections");
  revalidatePath(`/admin/elections/${election_id}`);
  revalidatePath("/elections");
  revalidatePath(`/elections/${election_id}`);
}

export async function finalizeHouseSenateGeneral(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const election_id = String(formData.get("election_id"));

  const { data: election } = await supabase
    .from("elections")
    .select("phase, office, district_code, state")
    .eq("id", election_id)
    .single();

  if (!election || election.phase !== "general") {
    throw new Error(
      `Finalize only runs in the general phase (current: ${election?.phase ?? "unknown"}). Use End primary or set phase to General first.`,
    );
  }
  if (election.office === "president") {
    throw new Error("Use presidential finalize for president races.");
  }

  const winnerUserId = await computeGeneralWinner(supabase, election_id, {
    office: election.office,
    district_code: election.district_code,
    state: election.state,
  });
  if (!winnerUserId) throw new Error("No candidates.");

  const { error } = await supabase
    .from("elections")
    .update({
      phase: "closed",
      winner_user_id: winnerUserId,
    })
    .eq("id", election_id);

  if (error) throw new Error(error.message);

  const { error: roleErr } = await supabase.rpc("apply_election_role_transitions", {
    e_election: election_id,
  });
  if (roleErr) {
    console.warn("[finalizeHouseSenateGeneral] role transition warning:", roleErr.message);
  }

  revalidatePath("/admin/elections");
  revalidatePath(`/admin/elections/${election_id}`);
  revalidatePath("/elections");
  revalidatePath(`/elections/${election_id}`);
}

export async function finalizePresident(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const election_id = String(formData.get("election_id"));
  const winner_candidate_id = String(formData.get("winner_candidate_id"));

  const { data: election } = await supabase
    .from("elections")
    .select("phase, office")
    .eq("id", election_id)
    .single();

  if (!election || election.office !== "president") throw new Error("Not a presidential race.");
  if (election.phase !== "general") {
    throw new Error(
      `President finalize needs general phase (current: ${election.phase}). End primary or set phase to General first.`,
    );
  }

  const { data: cand } = await supabase
    .from("election_candidates")
    .select("user_id")
    .eq("id", winner_candidate_id)
    .eq("election_id", election_id)
    .maybeSingle();

  if (!cand) throw new Error("Winner candidate not in this election.");

  const { error } = await supabase
    .from("elections")
    .update({ phase: "closed", winner_user_id: cand.user_id })
    .eq("id", election_id);

  if (error) throw new Error(error.message);

  const { error: roleErr } = await supabase.rpc("apply_election_role_transitions", {
    e_election: election_id,
  });
  if (roleErr) {
    console.warn("[finalizePresident] role transition warning:", roleErr.message);
  }

  revalidatePath("/admin/elections");
  revalidatePath(`/admin/elections/${election_id}`);
  revalidatePath("/elections");
  revalidatePath(`/elections/${election_id}`);
}

export async function setCandidateCampaignPoints(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const election_id = String(formData.get("election_id"));
  const candidate_id = String(formData.get("candidate_id"));
  const raw = String(formData.get("campaign_points_total") ?? "").trim();
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0) throw new Error("Campaign points must be a non-negative number.");
  if (n > 10_000_000) throw new Error("Value too large.");

  const { data: row } = await supabase
    .from("election_candidates")
    .select("id")
    .eq("id", candidate_id)
    .eq("election_id", election_id)
    .maybeSingle();

  if (!row) throw new Error("Candidate not in this election.");

  const { error } = await supabase
    .from("election_candidates")
    .update({ campaign_points_total: n })
    .eq("id", candidate_id)
    .eq("election_id", election_id);

  if (error) throw new Error(error.message);
  revalidatePath(`/admin/elections/${election_id}`);
  revalidatePath(`/elections/${election_id}`);
}

export async function deleteElection(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("election_id"));
  const { error } = await supabase.from("elections").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/elections");
  revalidatePath("/elections");
}

export async function fileCandidacy(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const election_id = String(formData.get("election_id"));

  const { data: election } = await supabase
    .from("elections")
    .select(
      "phase, filing_opens_at, filing_closes_at, office, state, district_code, leadership_role, restricted_party",
    )
    .eq("id", election_id)
    .single();

  if (!election || election.phase !== "filing") throw new Error("Filing is not open.");
  const now = new Date();
  if (now < new Date(election.filing_opens_at) || now > new Date(election.filing_closes_at)) {
    throw new Error("Outside filing window.");
  }

  const { data: existing } = await supabase
    .from("election_candidates")
    .select("id")
    .eq("election_id", election_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) throw new Error("You are already filed for this race.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("party, residence_state, home_district_code, office_role")
    .eq("id", user.id)
    .maybeSingle();

  const party = candidacyPartyFromProfile(profile?.party);
  if (!party) throw new Error("Set your party on the Character page before filing.");

  // Leadership races have a separate eligibility check: you have to hold the matching chamber
  // role and, for partisan leadership races, match the restricted party. We don't run the
  // geography / one-congressional-seat limits from getFilingEligibilityMessage here because
  // leadership filings don't take up the congressional seat slot.
  if (isLeadershipRole(election.leadership_role)) {
    const leadershipRole = election.leadership_role as LeadershipRole;
    const needed = requiredChamberRoleKey(leadershipRole);
    const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile ?? null);
    if (!roleKeys.includes(needed)) {
      const label = needed === "representative" ? "representative" : "senator";
      throw new Error(`Only sitting ${label}s can file for this leadership race.`);
    }
    if (
      isPartisanLeadershipRole(leadershipRole) &&
      election.restricted_party &&
      party !== election.restricted_party
    ) {
      throw new Error(
        `This leadership race is restricted to the ${election.restricted_party} caucus.`,
      );
    }
  } else {
    const activeSlots = await loadActiveCandidacySlots(supabase, user.id);
    const block = getFilingEligibilityMessage(
      election.office,
      { state: election.state, district_code: election.district_code },
      profile ?? null,
      activeSlots,
    );
    if (block) throw new Error(block);
  }

  const { error } = await supabase.from("election_candidates").insert({
    election_id,
    user_id: user.id,
    party,
  });

  if (error) throw new Error(error.message);
  await runElectionPhaseSchedule(supabase);
  revalidatePath("/elections");
  revalidatePath(`/elections/${election_id}`);
}

export async function castPrimaryVote(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const election_id = String(formData.get("election_id"));
  const candidate_id = String(formData.get("candidate_id"));

  const { data: election } = await supabase
    .from("elections")
    .select(
      "phase, primary_closes_at, office, state, district_code, primary_party_wide, leadership_role",
    )
    .eq("id", election_id)
    .single();

  if (election?.leadership_role) {
    throw new Error("Leadership races have no primary. Wait for the general vote.");
  }

  if (!election || election.phase !== "primary") {
    throw new Error(
      election?.phase === "general"
        ? "This race has already moved to the general election. Refresh the page."
        : "Primary is not open for this race. Refresh the page.",
    );
  }
  const now = new Date();
  if (now > new Date(election.primary_closes_at)) throw new Error("Primary voting has closed.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("party, residence_state, home_district_code")
    .eq("id", user.id)
    .single();

  const { data: cand } = await supabase
    .from("election_candidates")
    .select("party, user_id")
    .eq("id", candidate_id)
    .eq("election_id", election_id)
    .single();

  if (!cand) throw new Error("Candidate not found.");
  if (!profile?.party) throw new Error("Set your party on the Character page before voting in a primary.");
  if (profile.party !== cand.party) throw new Error("You may only vote in your party's primary.");

  const normDistrict = (c: string | null | undefined) => (c ?? "").trim().toUpperCase();
  const normState = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
  const selfVote = cand.user_id === user.id;
  const primaryPartyWide = election.primary_party_wide ?? true;

  const restrictPrimary =
    primaryPartyWide === false && election.office !== "president" && !selfVote;

  if (restrictPrimary) {
    if (election.office === "house") {
      const home = normDistrict(profile.home_district_code);
      const seat = normDistrict(election.district_code);
      if (!home || home !== seat) {
        throw new Error(
          "This primary is limited to players whose home district matches this seat. Update your Character record, choose a party-wide primary race, or vote for yourself if you are on this ballot.",
        );
      }
    } else if (election.office === "senate") {
      const res = normState(profile.residence_state);
      const st = normState(election.state);
      if (!res || res !== st) {
        throw new Error(
          "This primary is limited to players whose residence state matches this Senate seat. Update your Character record or choose a party-wide primary race.",
        );
      }
    }
  }

  const { data: existing } = await supabase
    .from("primary_votes")
    .select("candidate_id")
    .eq("election_id", election_id)
    .eq("voter_id", user.id)
    .maybeSingle();

  if (existing?.candidate_id === candidate_id) {
    const { error: delErr } = await supabase
      .from("primary_votes")
      .delete()
      .eq("election_id", election_id)
      .eq("voter_id", user.id);
    if (delErr) throw new Error(delErr.message);
    await runElectionPhaseSchedule(supabase);
    revalidatePath(`/elections/${election_id}`);
    return;
  }

  const { error } = await supabase.from("primary_votes").upsert(
    {
      election_id,
      voter_id: user.id,
      candidate_id,
    },
    { onConflict: "election_id,voter_id" },
  );

  if (error) throw new Error(error.message);
  await runElectionPhaseSchedule(supabase);
  revalidatePath(`/elections/${election_id}`);
}

const SPEECH_MIN_WORDS = 200;
const SPEECH_POINTS = 5;
const RALLY_POINTS = 0.5;
const RALLY_WINDOW_MS = 3 * 60 * 60 * 1000;
const RALLY_LIMIT_PER_WINDOW = 10;

export async function submitCampaignSpeech(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const election_id = String(formData.get("election_id"));
  const content = String(formData.get("content") ?? "").trim();
  const target_state =
    String(formData.get("target_state") ?? "").trim().toUpperCase() || null;
  const wordCount = countWords(content);
  if (wordCount < SPEECH_MIN_WORDS) {
    throw new Error(`Speech must be at least ${SPEECH_MIN_WORDS} words.`);
  }

  const { data: election } = await supabase
    .from("elections")
    .select("phase, office, state, district_code, general_closes_at, leadership_role")
    .eq("id", election_id)
    .maybeSingle();
  if (!election || election.phase !== "general") {
    throw new Error("General election is not open.");
  }
  if (election.leadership_role) {
    throw new Error("Speeches and rallies don't apply to leadership races — they're decided by plain plurality.");
  }
  if (new Date() > new Date(election.general_closes_at)) {
    throw new Error("General election is closed.");
  }

  const { data: candidate } = await supabase
    .from("election_candidates")
    .select("id")
    .eq("election_id", election_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!candidate) throw new Error("Only candidates in this race can submit speeches.");

  // Speech targeting:
  //   house   -> auto-attributed to the district (and state) of the race.
  //   senate  -> auto-attributed to the state of the race.
  //   president -> caller picks a state; required so we can run per-state scoring later.
  let stateForSpeech: string | null = null;
  let districtForSpeech: string | null = null;
  if (election.office === "house") {
    stateForSpeech = election.state;
    districtForSpeech = election.district_code;
  } else if (election.office === "senate") {
    stateForSpeech = election.state;
  } else if (election.office === "president") {
    if (!target_state || target_state.length !== 2) {
      throw new Error("Presidential speeches must specify a target state.");
    }
    stateForSpeech = target_state;
  }

  const { error } = await supabase.from("campaign_speeches").insert({
    election_id,
    candidate_id: candidate.id,
    author_id: user.id,
    content,
    word_count: wordCount,
    points: SPEECH_POINTS,
    target_state: stateForSpeech,
    target_district: districtForSpeech,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/elections/${election_id}`);
  revalidatePath(`/admin/elections/${election_id}`);
}

export async function submitCampaignRally(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const election_id = String(formData.get("election_id"));
  const target_state = String(formData.get("target_state") ?? "").trim().toUpperCase() || null;
  const target_district = String(formData.get("target_district") ?? "").trim().toUpperCase() || null;

  const { data: election } = await supabase
    .from("elections")
    .select("phase, office, state, district_code, general_closes_at, leadership_role")
    .eq("id", election_id)
    .maybeSingle();
  if (!election || election.phase !== "general") throw new Error("General election is not open.");
  if (election.leadership_role) {
    throw new Error("Speeches and rallies don't apply to leadership races — they're decided by plain plurality.");
  }
  if (new Date() > new Date(election.general_closes_at)) throw new Error("General election is closed.");

  const { data: candidate } = await supabase
    .from("election_candidates")
    .select("id")
    .eq("election_id", election_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!candidate) throw new Error("Only candidates in this race can rally.");

  const windowStart = new Date(Date.now() - RALLY_WINDOW_MS).toISOString();
  const { count } = await supabase
    .from("campaign_rallies")
    .select("id", { count: "exact", head: true })
    .eq("election_id", election_id)
    .eq("candidate_id", candidate.id)
    .gte("created_at", windowStart);
  if ((count ?? 0) >= RALLY_LIMIT_PER_WINDOW) {
    throw new Error(
      `Rally cap reached: ${RALLY_LIMIT_PER_WINDOW} rallies per 3-hour window. Try again later.`,
    );
  }

  // Rally targeting:
  //   house     -> must equal the race's district. Auto-filled by the UI.
  //   senate    -> must equal the race's state. Auto-filled by the UI.
  //   president -> caller picks any valid two-letter state.
  let rallyState = target_state;
  let rallyDistrict = target_district;
  if (election.office === "house") {
    if (!election.district_code) throw new Error("Race missing district.");
    rallyDistrict = election.district_code;
    rallyState = election.state;
  } else if (election.office === "senate") {
    if (!election.state) throw new Error("Race missing state.");
    rallyState = election.state;
    rallyDistrict = null;
  } else if (election.office === "president") {
    if (!target_state || target_state.length !== 2) {
      throw new Error("Presidential rallies must specify a valid two-letter state.");
    }
    rallyState = target_state;
    rallyDistrict = null;
  }

  const { error } = await supabase.from("campaign_rallies").insert({
    election_id,
    candidate_id: candidate.id,
    actor_id: user.id,
    target_state: rallyState,
    target_district: rallyDistrict,
    points: RALLY_POINTS,
  });
  if (error) {
    const msg = error.message;
    if (msg.includes("campaign_rallies") || msg.toLowerCase().includes("schema cache")) {
      throw new Error(
        `${msg} Fix: Supabase → SQL Editor → open and run the whole file supabase/migrations/20260421000000_ensure_campaign_events.sql from this repo (creates campaign_rallies + policies + NOTIFY reload). If \`supabase db push\` works on your machine, run that instead. Still stuck? Run supabase/migrations/20260421100000_pgrst_reload_schema.sql or Dashboard → Settings → API → reload schema.`,
      );
    }
    throw new Error(msg);
  }
  revalidatePath(`/elections/${election_id}`);
  revalidatePath(`/admin/elections/${election_id}`);
}

export async function submitCampaignEndorsement(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const election_id = String(formData.get("election_id"));
  const candidate_id = String(formData.get("candidate_id"));

  const { data: election } = await supabase
    .from("elections")
    .select("phase, general_closes_at")
    .eq("id", election_id)
    .maybeSingle();
  if (!election || election.phase !== "general") throw new Error("General election is not open.");
  if (new Date() > new Date(election.general_closes_at)) throw new Error("General election is closed.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const points = endorsementPointsForRoles(roleKeys);
  if (points <= 0) throw new Error("Only current members/leaders can endorse in this system.");

  const role_key =
    roleKeys.find((k) =>
      [
        "speaker",
        "president_pro_tempore",
        "senate_majority_leader",
        "senate_minority_leader",
        "house_majority_leader",
        "house_minority_leader",
        "senate_majority_whip",
        "senate_minority_whip",
        "house_majority_whip",
        "house_minority_whip",
        "senator",
        "representative",
      ].includes(k),
    ) ?? "citizen";

  const { data: candidate } = await supabase
    .from("election_candidates")
    .select("id")
    .eq("id", candidate_id)
    .eq("election_id", election_id)
    .maybeSingle();
  if (!candidate) throw new Error("Candidate not found in this race.");

  const { error } = await supabase.from("campaign_endorsements").upsert(
    {
      election_id,
      candidate_id,
      endorser_user_id: user.id,
      role_key,
      points,
    },
    { onConflict: "election_id,endorser_user_id" },
  );
  if (error) throw new Error(error.message);
  revalidatePath(`/elections/${election_id}`);
  revalidatePath(`/admin/elections/${election_id}`);
}

export async function castGeneralVote(formData: FormData): Promise<void> {

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const election_id = String(formData.get("election_id"));
  const candidate_id = String(formData.get("candidate_id"));

  const { data: election } = await supabase
    .from("elections")
    .select("phase, general_closes_at, leadership_role, restricted_party")
    .eq("id", election_id)
    .single();

  if (!election || election.phase !== "general") throw new Error("General election is not open.");
  const now = new Date();
  if (now > new Date(election.general_closes_at)) throw new Error("General voting has closed.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("party, residence_state, home_district_code, office_role")
    .eq("id", user.id)
    .single();

  const voter_state =
    profile?.residence_state ??
    (profile?.home_district_code ? profile.home_district_code.slice(0, 2) : null);

  // Leadership races restrict the ballot to the chamber (and, for partisan caucuses, to
  // the same party). Admins can always vote so they can demo / fix stuck elections.
  if (isLeadershipRole(election.leadership_role)) {
    const leadershipRole = election.leadership_role as LeadershipRole;
    const needed = requiredChamberRoleKey(leadershipRole);
    const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile ?? null);
    const isAdmin = roleKeys.includes("admin");
    if (!isAdmin) {
      if (!roleKeys.includes(needed)) {
        const label = needed === "representative" ? "representatives" : "senators";
        throw new Error(`Only sitting ${label} can vote in this leadership race.`);
      }
      if (
        isPartisanLeadershipRole(leadershipRole) &&
        election.restricted_party &&
        (profile?.party ?? "").toLowerCase() !== election.restricted_party
      ) {
        throw new Error(
          `This caucus election is limited to ${election.restricted_party} members.`,
        );
      }
    }
  }

  const { data: cand } = await supabase
    .from("election_candidates")
    .select("id")
    .eq("id", candidate_id)
    .eq("election_id", election_id)
    .single();

  if (!cand) throw new Error("Candidate not found.");

  const { data: existing } = await supabase
    .from("general_votes")
    .select("candidate_id")
    .eq("election_id", election_id)
    .eq("voter_id", user.id)
    .maybeSingle();

  if (existing?.candidate_id === candidate_id) {
    const { error: delErr } = await supabase
      .from("general_votes")
      .delete()
      .eq("election_id", election_id)
      .eq("voter_id", user.id);
    if (delErr) throw new Error(delErr.message);
    await runElectionPhaseSchedule(supabase);
    revalidatePath(`/elections/${election_id}`);
    return;
  }

  const { error } = await supabase.from("general_votes").upsert(
    {
      election_id,
      voter_id: user.id,
      candidate_id,
      voter_state,
    },
    { onConflict: "election_id,voter_id" },
  );

  if (error) throw new Error(error.message);
  revalidatePath(`/elections/${election_id}`);
}
