"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/is-admin";
import { endorsementPointsForRoles } from "@/lib/fec";
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
import {
  canReachPhaseForward,
  computeGeneralWinner,
  type ElectionWinnerResult,
  computePresidentialWinnerUserId,
  type ElectionCloseRow,
  type ElectionPhase,
  finalizeElectionToClosed,
  pickPrimaryWinners,
  resolveGeneralElectionWinner,
} from "@/lib/election-closeout";
import { seedElectionNpcOpponents } from "@/lib/election-npc-opponents";
import { throwIfPostgrestError } from "@/lib/supabase-error";
import { pickNextSenateClassForState } from "@/lib/senate-seat-class";
import { getStaffAccess, requireAnyStaffPermission } from "@/lib/staff-access";

function electionWinnerUpdateFields(result: ElectionWinnerResult): Record<string, unknown> {
  return {
    winner_user_id: result.winner_user_id,
    winner_candidate_id: result.winner_candidate_id,
  };
}

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
  const dormantFiling =
    String(formData.get("dormant_filing_window") ?? "").trim().toLowerCase() === "on" ||
    String(formData.get("dormant_filing_window") ?? "").trim() === "1";

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
      filing_window_started_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("elections").insert(row);
    throwIfPostgrestError(error);
    revalidatePath("/admin/elections");
    revalidatePath("/elections");
    return;
  }

  const primary_closes_at_raw = String(formData.get("primary_closes_at") ?? "").trim();
  if (!primary_closes_at_raw) throw new Error("Primary close time is required for seat races.");
  primary_closes_at = parseLocalDateTime(primary_closes_at_raw);
  if (primary_closes_at < filing_closes_at) throw new Error("Primary must end after filing.");
  if (general_closes_at < primary_closes_at) throw new Error("General must end after primary.");

  let senateSeatClass: number | null = null;
  if (office === "house") {
    if (!state || !["NE", "SO", "WE"].includes(state)) {
      throw new Error("House races need a region code: NE, SO, or WE.");
    }
    if (!district_code) throw new Error("House races need a district code (e.g. NE-01).");
  } else if (office === "senate") {
    if (!state || !["NE", "SO", "WE"].includes(state)) {
      throw new Error("Senate races need a region code: NE, SO, or WE.");
    }
    if (!["NE", "SO", "WE"].includes(state)) {
      throw new Error("Senate races need a region code: NE, SO, or WE.");
    }
    if (senate_class != null && Number.isFinite(senate_class) && senate_class >= 1 && senate_class <= 3) {
      senateSeatClass = senate_class;
    } else {
      const picked = await pickNextSenateClassForState(supabase, state);
      if (picked == null) {
        throw new Error(
          "Senate seat auto-assign failed: this region already has open races for seats 1, 2, and 3. Close or complete one first, or set the seat manually.",
        );
      }
      senateSeatClass = picked;
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

  // We intentionally do NOT set leadership_role / restricted_party. Those columns were from
  // the old "leadership race" concept and we've moved to public.leadership_sessions instead.
  // Omitting them also keeps createElection forward-compatible with databases that were set
  // up before the 20260427 migration and don't have the columns at all.
  const districtNormalized =
    office === "house" && district_code ? String(district_code).trim().toUpperCase() : null;

  const row = {
    office,
    state: office === "president" ? null : state,
    district_code: districtNormalized,
    senate_class: office === "senate" ? senateSeatClass : null,
    phase: "filing" as ElectionPhase,
    filing_opens_at,
    filing_closes_at,
    primary_closes_at,
    general_closes_at,
    primary_party_wide,
    filing_window_started_at: dormantFiling ? null : new Date().toISOString(),
  };

  const { error } = await supabase.from("elections").insert(row);
  throwIfPostgrestError(error);
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

  throwIfPostgrestError(error);
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
 *   general -> closed   : finalize. House/Senate use the full FEC score; President uses electoral-college
 *                         math (same as the live map). If no EV are awarded yet, winner is left unset.
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
  const isForward = canReachPhaseForward(prevPhase, phase);

  if (phase === "closed") {
    const winner = await finalizeElectionToClosed(supabase, {
      id: current.id,
      phase: prevPhase,
      office: current.office,
      state: current.state,
      district_code: current.district_code,
      leadership_role: current.leadership_role,
    });
    Object.assign(updates, electionWinnerUpdateFields(winner));
  } else if (isForward && phase === "primary" && prevPhase === "filing" && !current.leadership_role) {
    await seedElectionNpcOpponents(supabase, id);
  } else if (isForward && phase === "general") {
    // Ensure primary winners are flagged before moving out of filing/primary. Leadership
    // races skip the primary entirely so we don't run pickPrimaryWinners for them.
    if ((prevPhase === "filing" || prevPhase === "primary") && !current.leadership_role) {
      await pickPrimaryWinners(supabase, id);
    }
  }

  const { error } = await supabase.from("elections").update(updates).eq("id", id);
  throwIfPostgrestError(error);

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

async function closeSeatElectionRows(supabase: SupabaseClient, rows: ElectionCloseRow[]): Promise<void> {
  const targets = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const errors: string[] = [];
  for (const row of targets) {
    try {
      const winner = await finalizeElectionToClosed(supabase, {
        id: row.id,
        phase: row.phase as ElectionPhase,
        office: row.office,
        state: row.state,
        district_code: row.district_code,
        leadership_role: row.leadership_role,
      });
      const upd: Record<string, unknown> = { phase: "closed", ...electionWinnerUpdateFields(winner) };
      const { error } = await supabase.from("elections").update(upd).eq("id", row.id);
      throwIfPostgrestError(error);
      const { error: roleErr } = await supabase.rpc("apply_election_role_transitions", {
        e_election: row.id,
      });
      if (roleErr) {
        console.warn("[closeSeatElectionRows] role transition warning:", roleErr.message);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${row.id}: ${msg}`);
    }
  }

  if (errors.length) {
    throw new Error(`${errors.length} race(s) failed. ${errors.slice(0, 8).join("; ")}`);
  }

  revalidatePath("/admin/elections");
  revalidatePath("/elections");
  for (const row of targets) {
    revalidatePath(`/admin/elections/${row.id}`);
    revalidatePath(`/elections/${row.id}`);
  }
}

function asCloseRows(
  rows: Array<{
    id: string;
    phase: string;
    office: string;
    state: string | null;
    district_code: string | null;
    leadership_role: string | null;
  }> | null,
): ElectionCloseRow[] {
  return (rows ?? []).map((r) => ({
    id: r.id,
    phase: r.phase as ElectionPhase,
    office: r.office,
    state: r.state,
    district_code: r.district_code,
    leadership_role: r.leadership_role,
  }));
}

/** End every non-closed seat race for the offices you select (House, Senate, President). */
export async function bulkEndElections(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const endHouse = String(formData.get("end_house") ?? "") === "1";
  const endSenate = String(formData.get("end_senate") ?? "") === "1";
  const endPresident = String(formData.get("end_president") ?? "") === "1";

  if (!endHouse && !endSenate && !endPresident) {
    throw new Error("Select at least one of House, Senate, or President.");
  }

  const { data: rows, error: qErr } = await supabase
    .from("elections")
    .select("id, phase, office, state, district_code, leadership_role")
    .neq("phase", "closed")
    .is("leadership_role", null);

  throwIfPostgrestError(qErr);

  const targets = asCloseRows(rows ?? []).filter((r) => {
    if (r.office === "house" && endHouse) return true;
    if (r.office === "senate" && endSenate) return true;
    if (r.office === "president" && endPresident) return true;
    return false;
  });

  await closeSeatElectionRows(supabase, targets);
}

export async function closeHouseSeatElections(): Promise<void> {
  const { supabase } = await requireAdmin();
  const { data: rows, error: qErr } = await supabase
    .from("elections")
    .select("id, phase, office, state, district_code, leadership_role")
    .eq("office", "house")
    .neq("phase", "closed")
    .is("leadership_role", null);
  throwIfPostgrestError(qErr);
  await closeSeatElectionRows(supabase, asCloseRows(rows ?? []));
}

export async function closeSenateClassSeatElections(senateClass: 1 | 2 | 3): Promise<void> {
  const { supabase } = await requireAdmin();
  const { data: rows, error: qErr } = await supabase
    .from("elections")
    .select("id, phase, office, state, district_code, leadership_role")
    .eq("office", "senate")
    .eq("senate_class", senateClass)
    .neq("phase", "closed")
    .is("leadership_role", null);
  throwIfPostgrestError(qErr);
  await closeSeatElectionRows(supabase, asCloseRows(rows ?? []));
}

export async function closePresidentSeatElections(): Promise<void> {
  const { supabase } = await requireAdmin();
  const { data: rows, error: qErr } = await supabase
    .from("elections")
    .select("id, phase, office, state, district_code, leadership_role")
    .eq("office", "president")
    .neq("phase", "closed")
    .is("leadership_role", null);
  throwIfPostgrestError(qErr);
  await closeSeatElectionRows(supabase, asCloseRows(rows ?? []));
}

export async function closeSenateClass1SeatElections(): Promise<void> {
  return closeSenateClassSeatElections(1);
}
export async function closeSenateClass2SeatElections(): Promise<void> {
  return closeSenateClassSeatElections(2);
}
export async function closeSenateClass3SeatElections(): Promise<void> {
  return closeSenateClassSeatElections(3);
}

/** End specific seat races (House / Senate / President) by id — same closeout rules as bulk end. */
export async function endSelectedElections(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const rawIds = formData.getAll("election_id");
  const ids = [...new Set(rawIds.map((x) => String(x).trim()).filter(Boolean))];
  if (!ids.length) {
    throw new Error("Select at least one race to end.");
  }

  const { data: rows, error: qErr } = await supabase
    .from("elections")
    .select("id, phase, office, state, district_code, leadership_role")
    .in("id", ids)
    .is("leadership_role", null)
    .neq("phase", "closed");

  throwIfPostgrestError(qErr);

  const found = new Set((rows ?? []).map((r) => r.id as string));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw new Error(
      `${missing.length} id(s) are not active seat races (closed, missing, or leadership): ${missing.slice(0, 6).join(", ")}`,
    );
  }

  const targets = [...(rows ?? [])].sort((a, b) => a.id.localeCompare(b.id));

  const errors: string[] = [];
  for (const row of targets) {
    try {
      const winner = await finalizeElectionToClosed(supabase, {
        id: row.id,
        phase: row.phase as ElectionPhase,
        office: row.office,
        state: row.state,
        district_code: row.district_code,
        leadership_role: row.leadership_role,
      });
      const upd: Record<string, unknown> = { phase: "closed", ...electionWinnerUpdateFields(winner) };
      const { error } = await supabase.from("elections").update(upd).eq("id", row.id);
      throwIfPostgrestError(error);
      const { error: roleErr } = await supabase.rpc("apply_election_role_transitions", {
        e_election: row.id,
      });
      if (roleErr) {
        console.warn("[endSelectedElections] role transition warning:", roleErr.message);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${row.id}: ${msg}`);
    }
  }

  if (errors.length) {
    throw new Error(`${errors.length} race(s) failed. ${errors.slice(0, 8).join("; ")}`);
  }

  revalidatePath("/admin/elections");
  revalidatePath("/elections");
  for (const row of targets) {
    revalidatePath(`/admin/elections/${row.id}`);
    revalidatePath(`/elections/${row.id}`);
  }
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
  throwIfPostgrestError(pe);

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
    throw new Error("Use Certify winner for presidential races.");
  }

  const winner = await resolveGeneralElectionWinner(supabase, election_id, {
    office: election.office,
    district_code: election.district_code,
    state: election.state,
  });
  if (!winner.winner_candidate_id) throw new Error("No candidates.");

  const { error } = await supabase
    .from("elections")
    .update({
      phase: "closed",
      ...electionWinnerUpdateFields(winner),
    })
    .eq("id", election_id);

  throwIfPostgrestError(error);

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
  // Optional override. When present, the admin certifies a specific candidate.
  // Otherwise uses national points-only scoring (same as House/Senate).
  const overrideCandidateId = String(formData.get("winner_candidate_id") ?? "").trim();

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

  let winnerUserId: string | null = null;

  if (overrideCandidateId) {
    const { data: cand } = await supabase
      .from("election_candidates")
      .select("user_id")
      .eq("id", overrideCandidateId)
      .eq("election_id", election_id)
      .maybeSingle();
    if (!cand) throw new Error("Winner candidate not in this election.");
    winnerUserId = cand.user_id;
  } else {
    winnerUserId = await computePresidentialWinnerUserId(supabase, election_id);
    if (!winnerUserId) {
      throw new Error(
        "Could not determine a winner from campaign scores and general votes. Override the winner manually or check that candidates have activity.",
      );
    }
  }

  const { error } = await supabase
    .from("elections")
    .update({ phase: "closed", winner_user_id: winnerUserId })
    .eq("id", election_id);

  throwIfPostgrestError(error);

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

/** Fix a closed (or still-open) president race certified with the wrong closeout path. */
export async function recertifyPresidentElectoralWinner(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const election_id = String(formData.get("election_id") ?? "").trim();
  if (!election_id) throw new Error("Missing election id.");

  const { data: election } = await supabase
    .from("elections")
    .select("phase, office")
    .eq("id", election_id)
    .maybeSingle();
  if (!election || election.office !== "president") throw new Error("Not a presidential race.");
  if (election.phase !== "general" && election.phase !== "closed") {
    throw new Error(`Recertify only applies in general or closed phase (current: ${election.phase}).`);
  }

  const winnerUserId = await computePresidentialWinnerUserId(supabase, election_id);
  if (!winnerUserId) {
    throw new Error(
      "Could not determine a winner from campaign scores and general votes.",
    );
  }

  const updates: Record<string, unknown> = { winner_user_id: winnerUserId };
  if (election.phase === "general") updates.phase = "closed";

  const { error } = await supabase.from("elections").update(updates).eq("id", election_id);
  throwIfPostgrestError(error);

  const { error: roleErr } = await supabase.rpc("apply_election_role_transitions", {
    e_election: election_id,
  });
  if (roleErr) {
    console.warn("[recertifyPresidentElectoralWinner] role transition warning:", roleErr.message);
  }

  revalidatePath("/admin/elections");
  revalidatePath(`/admin/elections/${election_id}`);
  revalidatePath("/elections");
  revalidatePath(`/elections/${election_id}`);
}

/** Re-run SQL role transitions for a closed president race (e.g. after VP grant migration). */
export async function reapplyPresidentRoleTransitions(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const election_id = String(formData.get("election_id") ?? "").trim();
  if (!election_id) throw new Error("Missing election id.");

  const { data: election } = await supabase
    .from("elections")
    .select("office, phase")
    .eq("id", election_id)
    .maybeSingle();
  if (!election || election.office !== "president" || election.phase !== "closed") {
    throw new Error("Only closed presidential races can re-apply role transitions.");
  }

  const { error } = await supabase.rpc("admin_reapply_presidential_role_transitions", {
    e_election: election_id,
  });
  throwIfPostgrestError(error);

  revalidatePath("/admin/elections");
  revalidatePath(`/admin/elections/${election_id}`);
  revalidatePath("/elections");
  revalidatePath(`/elections/${election_id}`);
  revalidatePath("/directory");
}

async function requireElectionsConsoleStaff() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const access = await getStaffAccess();
  if (!access) throw new Error("Unauthorized");
  requireAnyStaffPermission(access, ["elections", "simulation"]);
  return { supabase, user };
}

/** Staff: remove a campaign speech; DB trigger subtracts its points from the candidate total. */
export async function deleteCampaignSpeech(formData: FormData): Promise<void> {
  const { supabase } = await requireElectionsConsoleStaff();
  const speech_id = String(formData.get("speech_id") ?? "").trim();
  const election_id = String(formData.get("election_id") ?? "").trim();
  if (!speech_id || !election_id) throw new Error("Missing speech or election id.");

  const { data: row } = await supabase
    .from("campaign_speeches")
    .select("id, election_id")
    .eq("id", speech_id)
    .maybeSingle();
  if (!row || row.election_id !== election_id) {
    throw new Error("Speech not found in this race.");
  }

  const { error } = await supabase.from("campaign_speeches").delete().eq("id", speech_id);
  throwIfPostgrestError(error);

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

  throwIfPostgrestError(error);
  revalidatePath(`/admin/elections/${election_id}`);
  revalidatePath(`/elections/${election_id}`);
}

export async function deleteElection(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("election_id"));
  const { error } = await supabase.from("elections").delete().eq("id", id);
  throwIfPostgrestError(error);
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
      "phase, filing_opens_at, filing_closes_at, filing_window_started_at, office, state, district_code, leadership_role, restricted_party",
    )
    .eq("id", election_id)
    .single();

  if (!election || election.phase !== "filing") throw new Error("Filing is not open.");
  if (!election.filing_window_started_at) {
    throw new Error("Filings for this race have not been opened by admins yet.");
  }
  // Match the UI: once the phase is `filing`, allow filing until filing_closes_at. We no
  // longer gate on filing_opens_at — the phase scheduler already controls both ends.
  const now = new Date();
  if (now > new Date(election.filing_closes_at)) {
    throw new Error("Filing window has already closed.");
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

  if (election.office === "president") {
    const { data: asMate, error: mateLookupErr } = await supabase
      .from("election_candidates")
      .select("id")
      .eq("election_id", election_id)
      .eq("running_mate_user_id", user.id)
      .maybeSingle();
    if (!mateLookupErr && asMate) {
      throw new Error(
        "You are already another ticket’s running mate in this presidential race. Ask that candidate to remove you first.",
      );
    }
  }

  const { error } = await supabase.from("election_candidates").insert({
    election_id,
    user_id: user.id,
    party,
  });

  throwIfPostgrestError(error);
  await runElectionPhaseSchedule(supabase, { force: true });
  revalidatePath("/elections");
  revalidatePath(`/elections/${election_id}`);
}

/** Presidential ticket: head candidate sets or updates their running mate (filing or primary). */
export async function setPresidentialRunningMate(_formData: FormData): Promise<void> {
  throw new Error("Running mates are disabled in baseline mode.");
}

/** Remove your candidacy during filing so you can file elsewhere (e.g. switch House ↔ Senate). */
export async function withdrawCandidacy(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const election_id = String(formData.get("election_id"));
  if (!election_id) throw new Error("Missing election.");

  const { data: election } = await supabase
    .from("elections")
    .select("phase")
    .eq("id", election_id)
    .maybeSingle();

  if (!election || election.phase !== "filing") {
    throw new Error("You can only withdraw during the filing phase.");
  }

  const { error } = await supabase
    .from("election_candidates")
    .delete()
    .eq("election_id", election_id)
    .eq("user_id", user.id);

  throwIfPostgrestError(error);

  await runElectionPhaseSchedule(supabase, { force: true });
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
  if (!election_id || !candidate_id) throw new Error("Missing election or candidate.");

  // STEP 1 — Unvote: ALWAYS allowed.
  // We check the current ballot first, before any phase/eligibility gates. That way
  // clicking "Unvote" keeps working even if (a) your profile changed after you voted,
  // (b) the primary has since closed, or (c) the phase scheduler moved the race to
  // general. Removing your own vote can never hurt anyone else, so we just let it
  // through and bail out.
  const { data: existingBefore } = await supabase
    .from("primary_votes")
    .select("candidate_id")
    .eq("election_id", election_id)
    .eq("voter_id", user.id)
    .maybeSingle();

  if (existingBefore?.candidate_id === candidate_id) {
    const { error: delErr } = await supabase
      .from("primary_votes")
      .delete()
      .eq("election_id", election_id)
      .eq("voter_id", user.id);
    if (delErr) throw new Error(`Could not clear your vote: ${delErr.message}`);
    await runElectionPhaseSchedule(supabase, { force: true });
    revalidatePath(`/elections/${election_id}`);
    return;
  }

  // STEP 2 — Fresh vote / change vote. Gate by phase + eligibility.
  const { data: election } = await supabase
    .from("elections")
    .select(
      "phase, primary_closes_at, office, state, district_code, primary_party_wide, leadership_role",
    )
    .eq("id", election_id)
    .maybeSingle();

  if (!election) throw new Error("Election not found.");
  if (election.leadership_role) {
    throw new Error("Leadership races have no primary. Wait for the general vote.");
  }

  if (election.phase !== "primary") {
    throw new Error(
      election.phase === "general"
        ? "This race has already moved to the general election. Refresh the page."
        : "Primary is not open for this race. Refresh the page.",
    );
  }
  if (election.primary_closes_at && new Date() > new Date(election.primary_closes_at)) {
    throw new Error("Primary voting has closed.");
  }

  const [{ data: profile }, { data: cand }] = await Promise.all([
    supabase
      .from("profiles")
      .select("party, residence_state, home_district_code")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("election_candidates")
      .select("party, user_id, is_npc")
      .eq("id", candidate_id)
      .eq("election_id", election_id)
      .maybeSingle(),
  ]);

  if (!cand) throw new Error("Candidate not found.");
  if (cand.is_npc) throw new Error("NPC placeholders are not on the primary ballot.");
  if (!profile?.party)
    throw new Error("Set your party on the Character page before voting in a primary.");
  if (profile.party !== cand.party)
    throw new Error("You may only vote in your party's primary.");

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

  // Explicit update-or-insert instead of upsert. The INSERT-on-conflict path in Supabase
  // needs BOTH the insert and update RLS policies to be satisfied at once; going through
  // the branch that matches reality avoids obscure "not authorized" errors when the
  // combined check fails.
  if (existingBefore) {
    const { error: updErr } = await supabase
      .from("primary_votes")
      .update({ candidate_id })
      .eq("election_id", election_id)
      .eq("voter_id", user.id);
    if (updErr) throw new Error(`Could not change your vote: ${updErr.message}`);
  } else {
    const { error: insErr } = await supabase.from("primary_votes").insert({
      election_id,
      voter_id: user.id,
      candidate_id,
    });
    if (insErr) throw new Error(`Could not record your vote: ${insErr.message}`);
  }

  await runElectionPhaseSchedule(supabase, { force: true });
  revalidatePath(`/elections/${election_id}`);
}

const SPEECH_MIN_WORDS = 200;
const SPEECH_POINTS = 5;
const RALLY_POINTS = 0.5;
const RALLY_WINDOW_MS = 3 * 60 * 60 * 1000;
const RALLY_LIMIT_PER_WINDOW = 10;

type RacePointTotals = { playerPts: number; opponentPts: number };

async function readRacePointTotals(
  supabase: SupabaseClient,
  electionId: string,
  playerCandidateId: string,
): Promise<RacePointTotals> {
  const { data: rows } = await supabase
    .from("election_candidates")
    .select("id, campaign_points_total, is_npc")
    .eq("election_id", electionId);
  const list = rows ?? [];
  const player = list.find((r) => r.id === playerCandidateId);
  const playerPts = Number(player?.campaign_points_total ?? 0);
  const opponentPts = list
    .filter((r) => r.id !== playerCandidateId && r.is_npc)
    .reduce((s, r) => s + Number(r.campaign_points_total ?? 0), 0);
  return { playerPts, opponentPts };
}

function buildCampaignActionResult(
  before: RacePointTotals,
  after: RacePointTotals,
  actionPointsAwarded: number,
  actionLabel: string,
  pulse: { speech?: boolean; counter_attack?: boolean },
) {
  return {
    npc_speech: Boolean(pulse.speech),
    npc_counter_attack: Boolean(pulse.counter_attack),
    action_points_awarded: actionPointsAwarded,
    action_label: actionLabel,
    player_points_delta: after.playerPts - before.playerPts,
    opponent_points_delta: after.opponentPts - before.opponentPts,
  };
}

/** After primaries, only nominee tickets may earn state-targeted campaign points. */
async function assertPresidentNomineeCanCampaign(
  supabase: Awaited<ReturnType<typeof createClient>>,
  electionId: string,
  candidateId: string,
  actionLabel: string,
): Promise<void> {
  const { data: rows } = await supabase
    .from("election_candidates")
    .select("id, primary_winner")
    .eq("election_id", electionId);
  const hasPrimaryWinners = (rows ?? []).some((r) => r.primary_winner);
  if (!hasPrimaryWinners) return;
  const mine = rows?.find((r) => r.id === candidateId);
  if (!mine?.primary_winner) {
    throw new Error(`Only presidential nominees on the general ballot can ${actionLabel}.`);
  }
}

async function resolvePresidentialCampaignCandidate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  electionId: string,
  userId: string,
): Promise<{ id: string; via: "ticket" | "endorsement" } | null> {
  const { data: headRow } = await supabase
    .from("election_candidates")
    .select("id")
    .eq("election_id", electionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (headRow?.id) return { id: headRow.id, via: "ticket" };

  const { data: endorsement } = await supabase
    .from("campaign_endorsements")
    .select("candidate_id")
    .eq("election_id", electionId)
    .eq("endorser_user_id", userId)
    .maybeSingle();
  if (!endorsement?.candidate_id) return null;
  return { id: endorsement.candidate_id, via: "endorsement" };
}

export type SubmitCampaignAdResult = {
  qty: number;
  ads_remaining: number | null;
  target_state: string | null;
  ad_type?: string;
  points?: number;
  cost?: number;
  outcome?: string;
  npc_counter_attack?: boolean;
  npc_speech?: boolean;
};

export async function submitCampaignAd(formData: FormData): Promise<SubmitCampaignAdResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const election_id = String(formData.get("election_id") ?? "").trim();
  const ad_type = String(formData.get("ad_type") ?? "persuasion").trim();
  const attack_target = String(formData.get("attack_target_id") ?? "").trim() || null;
  const qty = Math.floor(Number(String(formData.get("qty") ?? "1").trim()));
  if (!Number.isFinite(qty) || qty < 1 || qty > 100) {
    throw new Error("Quantity must be between 1 and 100.");
  }
  if (!election_id) throw new Error("Missing election id.");

  const { data: election } = await supabase
    .from("elections")
    .select("phase, office, general_closes_at, leadership_role")
    .eq("id", election_id)
    .maybeSingle();
  if (!election) throw new Error("Election not found.");
  if (election.leadership_role) {
    throw new Error("Campaign ads don't apply to leadership races.");
  }
  if (election.phase !== "general") {
    throw new Error("Campaign ads can only be used during the general election.");
  }
  if (new Date() > new Date(election.general_closes_at)) {
    throw new Error("General election is closed.");
  }

  let candidate: { id: string } | null = null;
  if (election.office === "president") {
    const campaignTarget = await resolvePresidentialCampaignCandidate(supabase, election_id, user.id);
    if (!campaignTarget) {
      throw new Error(
        "To campaign in this presidential race, join a ticket or endorse a candidate first.",
      );
    }
    const { data: c } = await supabase
      .from("election_candidates")
      .select("id")
      .eq("id", campaignTarget.id)
      .eq("election_id", election_id)
      .maybeSingle();
    candidate = c ?? null;
  } else {
    const { data: c } = await supabase
      .from("election_candidates")
      .select("id")
      .eq("election_id", election_id)
      .eq("user_id", user.id)
      .maybeSingle();
    candidate = c ?? null;
  }
  if (!candidate) throw new Error("Only candidates in this race can spend campaign ads.");

  if (election.office === "president") {
    await assertPresidentNomineeCanCampaign(supabase, election_id, candidate.id, "spend campaign ads");
  }

  const { data: rpcData, error } = await supabase.rpc("economy_use_campaign_ad", {
    p_election: election_id,
    p_candidate: candidate.id,
    p_target_state: null,
    p_qty: qty,
    p_ad_type: ad_type,
    p_target_candidate: attack_target,
  });
  if (error) {
    const msg = error.message ?? "Unknown database error.";
    if (election.office === "president" && msg.toLowerCase().includes("not your presidential ticket")) {
      throw new Error(
        `You can campaign for this ticket only if you're the candidate/running mate or have endorsed this candidate. If you already endorsed them, run migration supabase/migrations/20260472800000_presidential_endorser_campaign_permissions.sql.`,
      );
    }
    throwIfPostgrestError(error);
  }

  const row = (rpcData ?? {}) as Record<string, unknown>;
  const points = Math.max(0, Math.floor(Number(row.points ?? 0)));
  const cost = Number(row.cost ?? 0);

  revalidatePath("/economy");
  revalidatePath("/elections");
  revalidatePath(`/elections/${election_id}`);
  revalidatePath(`/admin/elections/${election_id}`);

  return {
    qty,
    ads_remaining:
      row.ads_remaining != null ? Math.max(0, Number(row.ads_remaining)) : null,
    target_state: null,
    ad_type,
    points,
    cost,
    outcome: String(row.outcome ?? "success"),
    npc_counter_attack: Boolean(row.npc_counter_attack),
    npc_speech: Boolean(row.npc_speech),
  };
}

export type CampaignNpcPulse = {
  npc_speech: boolean;
  npc_counter_attack: boolean;
  player_points_delta: number;
  opponent_points_delta: number;
  action_points_awarded: number;
  action_label: string;
};

export async function submitCampaignSpeech(formData: FormData): Promise<CampaignNpcPulse> {
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
  if (!election) throw new Error("Election not found.");
  if (election.leadership_role) {
    throw new Error("Speeches and rallies don't apply to leadership races — they're decided by plain plurality.");
  }
  if (election.phase !== "general") {
    throw new Error("Speeches and rallies are only open during the general election.");
  }
  if (new Date() > new Date(election.general_closes_at)) {
    throw new Error("General election is closed.");
  }

  let candidate: { id: string } | null = null;
  if (election.office === "president") {
    const campaignTarget = await resolvePresidentialCampaignCandidate(supabase, election_id, user.id);
    if (!campaignTarget) {
      throw new Error(
        "To campaign in this presidential race, join a ticket or endorse a candidate first.",
      );
    }
    const { data: c } = await supabase
      .from("election_candidates")
      .select("id")
      .eq("id", campaignTarget.id)
      .eq("election_id", election_id)
      .maybeSingle();
    candidate = c ?? null;
  } else {
    const { data: c } = await supabase
      .from("election_candidates")
      .select("id")
      .eq("election_id", election_id)
      .eq("user_id", user.id)
      .maybeSingle();
    candidate = c ?? null;
  }
  if (!candidate) throw new Error("Only candidates in this race can submit speeches.");
  if (election.office === "president") {
    await assertPresidentNomineeCanCampaign(supabase, election_id, candidate.id, "deliver speeches");
  }

  const beforePts = await readRacePointTotals(supabase, election_id, candidate.id);

  // Speech targeting:
  //   house   -> auto-attributed to the district (and state) of the race.
  //   senate  -> auto-attributed to the state of the race.
  //   president -> national race (no per-state targeting in baseline).
  let stateForSpeech: string | null = null;
  let districtForSpeech: string | null = null;
  if (election.office === "house") {
    stateForSpeech = election.state;
    districtForSpeech = election.district_code;
  } else if (election.office === "senate") {
    stateForSpeech = election.state;
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
  if (error) {
    const msg = error.message ?? "Unknown database error.";
    if (
      election.office === "president" &&
      (error.code === "42501" ||
        msg.toLowerCase().includes("not authorized") ||
        msg.toLowerCase().includes("permission denied"))
    ) {
      throw new Error(
        `Could not submit speech for this ticket: ${msg}. If you've endorsed this candidate, run migration supabase/migrations/20260472800000_presidential_endorser_campaign_permissions.sql.`,
      );
    }
    throwIfPostgrestError(error);
  }

  const { data: pulse, error: pulseError } = await supabase.rpc("election_npc_campaign_pulse", {
    p_election_id: election_id,
    p_player_candidate_id: candidate.id,
    p_trigger: "speech",
  });
  if (pulseError) throwIfPostgrestError(pulseError);

  const afterPts = await readRacePointTotals(supabase, election_id, candidate.id);

  revalidatePath(`/elections/${election_id}`);
  revalidatePath(`/admin/elections/${election_id}`);

  return buildCampaignActionResult(
    beforePts,
    afterPts,
    SPEECH_POINTS,
    "Speech delivered",
    (pulse ?? {}) as { speech?: boolean; counter_attack?: boolean },
  );
}

export async function submitCampaignRally(formData: FormData): Promise<CampaignNpcPulse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const election_id = String(formData.get("election_id"));
  const target_state = String(formData.get("target_state") ?? "").trim().toUpperCase() || null;
  const target_district = String(formData.get("target_district") ?? "").trim().toUpperCase() || null;
  const qtyRaw = Number(String(formData.get("qty") ?? "1").trim());
  const qty = Math.max(1, Math.min(50, Math.floor(Number.isFinite(qtyRaw) ? qtyRaw : 1)));

  const { data: election } = await supabase
    .from("elections")
    .select("phase, office, state, district_code, general_closes_at, leadership_role")
    .eq("id", election_id)
    .maybeSingle();
  if (!election) throw new Error("Election not found.");
  if (election.leadership_role) {
    throw new Error("Speeches and rallies don't apply to leadership races — they're decided by plain plurality.");
  }
  if (election.phase !== "general") {
    throw new Error("Speeches and rallies are only open during the general election.");
  }
  if (new Date() > new Date(election.general_closes_at)) {
    throw new Error("General election is closed.");
  }

  let candidate: { id: string } | null = null;
  if (election.office === "president") {
    const campaignTarget = await resolvePresidentialCampaignCandidate(supabase, election_id, user.id);
    if (!campaignTarget) {
      throw new Error(
        "To campaign in this presidential race, join a ticket or endorse a candidate first.",
      );
    }
    const { data: c } = await supabase
      .from("election_candidates")
      .select("id")
      .eq("id", campaignTarget.id)
      .eq("election_id", election_id)
      .maybeSingle();
    candidate = c ?? null;
  } else {
    const { data: c } = await supabase
      .from("election_candidates")
      .select("id")
      .eq("election_id", election_id)
      .eq("user_id", user.id)
      .maybeSingle();
    candidate = c ?? null;
  }
  if (!candidate) throw new Error("Only candidates in this race can rally.");
  if (election.office === "president") {
    await assertPresidentNomineeCanCampaign(supabase, election_id, candidate.id, "hold rallies");
  }

  const beforePts = await readRacePointTotals(supabase, election_id, candidate.id);

  const windowStart = new Date(Date.now() - RALLY_WINDOW_MS).toISOString();
  const { count } = await supabase
    .from("campaign_rallies")
    .select("id", { count: "exact", head: true })
    .eq("election_id", election_id)
    .eq("candidate_id", candidate.id)
    .gte("created_at", windowStart);
  const usedInWindow = count ?? 0;
  const remainingInWindow = Math.max(0, RALLY_LIMIT_PER_WINDOW - usedInWindow);
  if (remainingInWindow < 1) {
    throw new Error(
      `Rally cap reached: ${RALLY_LIMIT_PER_WINDOW} rallies per 3-hour window. Try again later.`,
    );
  }
  if (qty > remainingInWindow) {
    throw new Error(
      `You can only spend ${remainingInWindow} more ${remainingInWindow === 1 ? "rally" : "rallies"} this 3-hour window.`,
    );
  }

  // Rally targeting:
  //   house     -> must equal the race's district. Auto-filled by the UI.
  //   senate    -> must equal the race's state. Auto-filled by the UI.
  //   president -> national race (no per-state targeting in baseline).
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
    rallyState = null;
    rallyDistrict = null;
  }

  const rows = Array.from({ length: qty }, () => ({
    election_id,
    candidate_id: candidate.id,
    actor_id: user.id,
    target_state: rallyState,
    target_district: rallyDistrict,
    points: RALLY_POINTS,
  }));
  const { error } = await supabase.from("campaign_rallies").insert(rows);
  if (error) {
    const msg = error.message;
    if (
      election.office === "president" &&
      (error.code === "42501" ||
        msg.toLowerCase().includes("not authorized") ||
        msg.toLowerCase().includes("permission denied"))
    ) {
      throw new Error(
        `Could not submit rally for this ticket: ${msg}. If you've endorsed this candidate, run migration supabase/migrations/20260472800000_presidential_endorser_campaign_permissions.sql.`,
      );
    }
    if (msg.includes("campaign_rallies") || msg.toLowerCase().includes("schema cache")) {
      throw new Error(
        `${msg} Fix: Supabase → SQL Editor → open and run the whole file supabase/migrations/20260421000000_ensure_campaign_events.sql from this repo (creates campaign_rallies + policies + NOTIFY reload). If \`supabase db push\` works on your machine, run that instead. Still stuck? In SQL Editor run \`NOTIFY pgrst, 'reload schema';\` or use Dashboard → Settings → API → reload schema.`,
      );
    }
    throw new Error(msg);
  }

  const { data: pulse, error: pulseError } = await supabase.rpc("election_npc_campaign_pulse", {
    p_election_id: election_id,
    p_player_candidate_id: candidate.id,
    p_trigger: "rally",
  });
  if (pulseError) throwIfPostgrestError(pulseError);

  const afterPts = await readRacePointTotals(supabase, election_id, candidate.id);
  const rallyPointsAwarded = qty * RALLY_POINTS;

  revalidatePath(`/elections/${election_id}`);
  revalidatePath(`/admin/elections/${election_id}`);

  return buildCampaignActionResult(
    beforePts,
    afterPts,
    rallyPointsAwarded,
    qty === 1 ? "Rally recorded" : `${qty} rallies recorded`,
    (pulse ?? {}) as { speech?: boolean; counter_attack?: boolean },
  );
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
    .select("phase, general_closes_at, office")
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
  if (points <= 0 && election.office !== "president") {
    throw new Error("Only current members/leaders can endorse in this system.");
  }

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
    .select("id, user_id, running_mate_user_id")
    .eq("id", candidate_id)
    .eq("election_id", election_id)
    .maybeSingle();
  if (!candidate) throw new Error("Candidate not found in this race.");
  if (candidate.user_id === user.id) {
    throw new Error("You cannot endorse yourself.");
  }
  // Running mates endorse the nominee on their ticket (same candidate row); that must be allowed.

  const { error } = await supabase.from("campaign_endorsements").upsert(
    {
      election_id,
      candidate_id,
      endorser_user_id: user.id,
      role_key,
      points: election.office === "president" ? Math.max(0, points) : points,
    },
    { onConflict: "election_id,endorser_user_id" },
  );
  throwIfPostgrestError(error);
  revalidatePath(`/elections/${election_id}`);
  revalidatePath(`/admin/elections/${election_id}`);
}

export async function withdrawCampaignEndorsement(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const election_id = String(formData.get("election_id"));
  if (!election_id) throw new Error("Missing election id.");

  const { data: election } = await supabase
    .from("elections")
    .select("phase, general_closes_at")
    .eq("id", election_id)
    .maybeSingle();
  if (!election || election.phase !== "general") throw new Error("General election is not open.");
  if (new Date() > new Date(election.general_closes_at)) throw new Error("General election is closed.");

  const { error } = await supabase
    .from("campaign_endorsements")
    .delete()
    .eq("election_id", election_id)
    .eq("endorser_user_id", user.id);
  if (error) {
    const msg = error.message ?? "Unknown database error.";
    if (
      error.code === "42501" ||
      msg.toLowerCase().includes("not authorized") ||
      msg.toLowerCase().includes("permission denied")
    ) {
      throw new Error(
        `Could not withdraw endorsement: ${msg}. Your database likely needs migration supabase/migrations/20260472700000_campaign_endorsements_delete_self.sql.`,
      );
    }
    throwIfPostgrestError(error);
  }

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
  if (!election_id || !candidate_id) throw new Error("Missing election or candidate.");

  // STEP 1 — Unvote: ALWAYS allowed. See castPrimaryVote for the reasoning.
  const { data: existingBefore } = await supabase
    .from("general_votes")
    .select("candidate_id")
    .eq("election_id", election_id)
    .eq("voter_id", user.id)
    .maybeSingle();

  if (existingBefore?.candidate_id === candidate_id) {
    const { error: delErr } = await supabase
      .from("general_votes")
      .delete()
      .eq("election_id", election_id)
      .eq("voter_id", user.id);
    if (delErr) {
      const msg = delErr.message ?? "Unknown database error.";
      if (
        delErr.code === "42501" ||
        msg.toLowerCase().includes("not authorized") ||
        msg.toLowerCase().includes("permission denied")
      ) {
        throw new Error(
          `Could not clear your vote: ${msg}. This usually means your database is missing the vote self-update/delete migration. Run supabase/migrations/20260420120000_vote_self_update_delete.sql (or run your full migrations) and retry.`,
        );
      }
      throw new Error(`Could not clear your vote: ${msg}`);
    }
    await runElectionPhaseSchedule(supabase, { force: true });
    revalidatePath(`/elections/${election_id}`);
    return;
  }

  // STEP 2 — Fresh vote / change vote. Gate by phase + eligibility.
  const { data: election } = await supabase
    .from("elections")
    .select("phase, general_closes_at, leadership_role, restricted_party")
    .eq("id", election_id)
    .maybeSingle();

  if (!election) throw new Error("Election not found.");
  if (election.phase !== "general") throw new Error("General election is not open.");
  if (election.general_closes_at && new Date() > new Date(election.general_closes_at)) {
    throw new Error("General voting has closed.");
  }
  if (!isLeadershipRole(election.leadership_role)) {
    throw new Error("General ballots are disabled for seat and presidential races in points-only mode.");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("party, residence_state, home_district_code, office_role")
    .eq("id", user.id)
    .maybeSingle();

  const voter_state =
    profile?.residence_state ??
    (profile?.home_district_code ? profile.home_district_code.slice(0, 2) : null);

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
    .maybeSingle();

  if (!cand) throw new Error("Candidate not found.");

  // Explicit update-or-insert instead of upsert — same reasoning as castPrimaryVote.
  if (existingBefore) {
    const { error: updErr } = await supabase
      .from("general_votes")
      .update({ candidate_id, voter_state })
      .eq("election_id", election_id)
      .eq("voter_id", user.id);
    if (updErr) throw new Error(`Could not change your vote: ${updErr.message}`);
  } else {
    const { error: insErr } = await supabase.from("general_votes").insert({
      election_id,
      voter_id: user.id,
      candidate_id,
      voter_state,
    });
    if (insErr) throw new Error(`Could not record your vote: ${insErr.message}`);
  }

  revalidatePath(`/elections/${election_id}`);
}
