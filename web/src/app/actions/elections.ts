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
import { countWords } from "@/lib/word-count";

type ElectionPhase = "filing" | "primary" | "general" | "closed";

function parseLocalDateTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date/time");
  return d.toISOString();
}

export async function createElection(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();

  const office = String(formData.get("office") ?? "").trim() as "house" | "senate" | "president";
  const state = String(formData.get("state") ?? "").trim().toUpperCase() || null;
  const district_code = String(formData.get("district_code") ?? "").trim() || null;
  const senate_class_raw = String(formData.get("senate_class") ?? "").trim();
  const senate_class = senate_class_raw ? Number(senate_class_raw) : null;

  const filing_opens_at = parseLocalDateTime(String(formData.get("filing_opens_at")));
  const filing_closes_at = parseLocalDateTime(String(formData.get("filing_closes_at")));
  const primary_closes_at = parseLocalDateTime(String(formData.get("primary_closes_at")));
  const general_closes_at = parseLocalDateTime(String(formData.get("general_closes_at")));

  if (filing_closes_at < filing_opens_at) throw new Error("Filing must end after it opens.");
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
  let primary_party_wide = primary_ballot_scope !== "jurisdiction_only";
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

export async function setElectionPhase(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("election_id"));
  const phase = String(formData.get("phase")) as ElectionPhase;
  if (!["filing", "primary", "general", "closed"].includes(phase)) {
    throw new Error("Invalid phase.");
  }
  const { error } = await supabase.from("elections").update({ phase }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/elections");
  revalidatePath(`/admin/elections/${id}`);
  revalidatePath("/elections");
  revalidatePath(`/elections/${id}`);
}

/** Manual primary closeout; mirrors `advance_election_phases_by_schedule` in migration 20260420090000_election_auto_phase_schedule.sql. */
export async function endPrimarySelectWinners(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const election_id = String(formData.get("election_id"));

  const { data: election } = await supabase.from("elections").select("phase").eq("id", election_id).single();
  if (!election || election.phase !== "primary") {
    throw new Error(
      `End primary only works when the race is in the primary phase (current: ${election?.phase ?? "unknown"}). Use the Primary phase button first, then run this after primary votes.`,
    );
  }

  const { data: candidates } = await supabase
    .from("election_candidates")
    .select("id, party")
    .eq("election_id", election_id);

  if (!candidates?.length) throw new Error("No candidates.");

  const { data: votes } = await supabase
    .from("primary_votes")
    .select("candidate_id")
    .eq("election_id", election_id);

  const counts: Record<string, number> = {};
  for (const v of votes ?? []) {
    counts[v.candidate_id] = (counts[v.candidate_id] ?? 0) + 1;
  }

  /** Primary = site votes only (no campaign points). One nominee per filed party by in-party plurality. */
  const byParty = new Map<string, { id: string; party: string }[]>();
  for (const c of candidates) {
    const list = byParty.get(c.party) ?? [];
    list.push(c);
    byParty.set(c.party, list);
  }

  const winnerIds = new Set<string>();
  for (const group of byParty.values()) {
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    if (sorted.length === 1) {
      winnerIds.add(sorted[0]!.id);
      continue;
    }
    let bestId = sorted[0]!.id;
    let best = -1;
    for (const c of sorted) {
      const n = counts[c.id] ?? 0;
      if (n > best) {
        best = n;
        bestId = c.id;
      }
    }
    if (best <= 0) {
      bestId = sorted[0]!.id;
    }
    winnerIds.add(bestId);
  }

  for (const c of candidates) {
    const { error } = await supabase
      .from("election_candidates")
      .update({ primary_winner: winnerIds.has(c.id) })
      .eq("id", c.id);
    if (error) throw new Error(error.message);
  }

  const { error: pe } = await supabase.from("elections").update({ phase: "general" }).eq("id", election_id);
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
    .select("phase, office, district_code")
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

  const raceOffice = election.office;

  let districtPvi = 0;
  if (raceOffice === "house" && election.district_code) {
    const { data: d } = await supabase
      .from("districts")
      .select("pvi")
      .eq("code", election.district_code)
      .maybeSingle();
    districtPvi = Number(d?.pvi ?? 0);
  }

  const { data: candidates } = await supabase
    .from("election_candidates")
    .select("id, user_id, party, campaign_points_total, primary_winner")
    .eq("election_id", election_id);

  if (!candidates?.length) throw new Error("No candidates.");

  const hasPrimary = candidates.some((c) => c.primary_winner);
  const active = hasPrimary ? candidates.filter((c) => c.primary_winner) : candidates;

  const { data: gv } = await supabase
    .from("general_votes")
    .select("candidate_id")
    .eq("election_id", election_id);

  const tally: Record<string, number> = {};
  for (const v of gv ?? []) {
    tally[v.candidate_id] = (tally[v.candidate_id] ?? 0) + 1;
  }

  function leanForCandidate(party: string) {
    if (raceOffice !== "house") return 0;
    if (party === "democrat") return districtLeanBonus(districtPvi, "democrat");
    if (party === "republican") return districtLeanBonus(districtPvi, "republican");
    return 0;
  }

  const inputs = active.map((c) => ({
    id: c.id,
    party: c.party as Party,
    campaignPoints: Math.max(0, Number(c.campaign_points_total ?? 0)) + leanForCandidate(c.party),
  }));

  const scores = scoreGeneralElection(inputs, tally);
  let bestId: string | null = null;
  let bestScore = -Infinity;
  for (const c of active) {
    const s = scores[c.id] ?? 0;
    if (s > bestScore) {
      bestScore = s;
      bestId = c.id;
    } else if (s === bestScore && bestId && c.id.localeCompare(bestId) < 0) {
      bestId = c.id;
    }
  }

  const winnerRow = active.find((c) => c.id === bestId);
  if (!winnerRow) throw new Error("Unable to determine winner.");

  const { error } = await supabase
    .from("elections")
    .update({
      phase: "closed",
      winner_user_id: winnerRow.user_id,
    })
    .eq("id", election_id);

  if (error) throw new Error(error.message);
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
    .select("phase, filing_opens_at, filing_closes_at, office, state, district_code")
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
    .select("party, residence_state, home_district_code")
    .eq("id", user.id)
    .maybeSingle();

  const activeSlots = await loadActiveCandidacySlots(supabase, user.id);
  const block = getFilingEligibilityMessage(
    election.office,
    { state: election.state, district_code: election.district_code },
    profile ?? null,
    activeSlots,
  );
  if (block) throw new Error(block);

  const party = candidacyPartyFromProfile(profile?.party);
  if (!party) throw new Error("Set your party on the Character page before filing.");

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
    .select("phase, primary_closes_at, office, state, district_code, primary_party_wide")
    .eq("id", election_id)
    .single();

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

export async function submitCampaignSpeech(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const election_id = String(formData.get("election_id"));
  const content = String(formData.get("content") ?? "").trim();
  const wordCount = countWords(content);
  if (wordCount < 200) throw new Error("Speech must be at least 200 words.");

  const { data: election } = await supabase
    .from("elections")
    .select("phase, general_closes_at")
    .eq("id", election_id)
    .maybeSingle();
  if (!election || election.phase !== "general") throw new Error("General election is not open.");
  if (new Date() > new Date(election.general_closes_at)) throw new Error("General election is closed.");

  const { data: candidate } = await supabase
    .from("election_candidates")
    .select("id")
    .eq("election_id", election_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!candidate) throw new Error("Only candidates in this race can submit speeches.");

  const { error } = await supabase.from("campaign_speeches").insert({
    election_id,
    candidate_id: candidate.id,
    author_id: user.id,
    content,
    word_count: wordCount,
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
    .select("phase, office, state, district_code, general_closes_at")
    .eq("id", election_id)
    .maybeSingle();
  if (!election || election.phase !== "general") throw new Error("General election is not open.");
  if (new Date() > new Date(election.general_closes_at)) throw new Error("General election is closed.");

  const { data: candidate } = await supabase
    .from("election_candidates")
    .select("id")
    .eq("election_id", election_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!candidate) throw new Error("Only candidates in this race can rally.");

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("campaign_rallies")
    .select("id", { count: "exact", head: true })
    .eq("election_id", election_id)
    .eq("candidate_id", candidate.id)
    .gte("created_at", hourAgo);
  if ((count ?? 0) >= 5) throw new Error("Rally cap reached: max 5 rallies per hour.");

  if (election.office === "house") {
    if (!election.district_code || target_district !== election.district_code) {
      throw new Error("House candidates can only rally in their own district.");
    }
  } else if (election.office === "senate") {
    if (!election.state || target_state !== election.state) {
      throw new Error("Senate candidates can only rally in their own state.");
    }
  } else if (election.office === "president") {
    if (!target_state || target_state.length !== 2) {
      throw new Error("Presidential rallies must specify a valid two-letter state.");
    }
  }

  const { error } = await supabase.from("campaign_rallies").insert({
    election_id,
    candidate_id: candidate.id,
    actor_id: user.id,
    target_state,
    target_district,
    points: 0.5,
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
    .select("phase, general_closes_at")
    .eq("id", election_id)
    .single();

  if (!election || election.phase !== "general") throw new Error("General election is not open.");
  const now = new Date();
  if (now > new Date(election.general_closes_at)) throw new Error("General voting has closed.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("residence_state, home_district_code")
    .eq("id", user.id)
    .single();

  const voter_state =
    profile?.residence_state ??
    (profile?.home_district_code ? profile.home_district_code.slice(0, 2) : null);

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
