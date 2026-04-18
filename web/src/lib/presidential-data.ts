/**
 * Server-side helper that gathers everything needed to score a presidential race:
 * candidates, states (with PVI + electoral_votes), general votes, and campaign events.
 *
 * Used by both `finalizePresident` (server action) and the `/elections/[id]` page
 * so the admin-certified winner and the live map agree on the math.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  scorePresidentialElection,
  type PresCandidate,
  type PresCampaignEvent,
  type PresStateMeta,
  type PresVote,
  type PresidentialResult,
} from "@/lib/presidential-scoring";
import { STATE_ELECTORAL_VOTES as FALLBACK_EV } from "@/lib/electoral-votes";

export type PresidentialDataBundle = {
  candidates: PresCandidate[];
  states: PresStateMeta[];
  votes: PresVote[];
  events: PresCampaignEvent[];
};

function looksLikeMissingEvColumn(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("electoral_votes");
}

/**
 * Fetch the bits needed to score a presidential election. Safe to call even if the
 * `states.electoral_votes` migration hasn't been run yet — we fall back to the hard-coded
 * map in `@/lib/electoral-votes` so the page still renders.
 */
export async function loadPresidentialBundle(
  supabase: SupabaseClient,
  election_id: string,
): Promise<PresidentialDataBundle> {
  const [candidatesRes, votesRes, speechesRes, ralliesRes, statesRes] = await Promise.all([
    supabase
      .from("election_candidates")
      .select("id, user_id, party, primary_winner, created_at")
      .eq("election_id", election_id),
    supabase
      .from("general_votes")
      .select("candidate_id, voter_state")
      .eq("election_id", election_id),
    supabase
      .from("campaign_speeches")
      .select("candidate_id, target_state, points")
      .eq("election_id", election_id),
    supabase
      .from("campaign_rallies")
      .select("candidate_id, target_state, points")
      .eq("election_id", election_id),
    supabase
      .from("states")
      .select("code, name, pvi, electoral_votes")
      .order("code"),
  ]);

  let statesData = statesRes.data as
    | Array<{ code: string; name: string; pvi: number | null; electoral_votes?: number | null }>
    | null;
  if (statesRes.error && looksLikeMissingEvColumn(statesRes.error.message)) {
    const retry = await supabase
      .from("states")
      .select("code, name, pvi")
      .order("code");
    statesData = retry.data as typeof statesData;
  }

  const candidatesRaw = (candidatesRes.data ?? []) as Array<{
    id: string;
    user_id: string;
    party: string;
    primary_winner: boolean | null;
    created_at: string | null;
  }>;

  // Only score the general-election ballot. If any candidate has primary_winner=true, restrict
  // to nominees; otherwise (no primary was held) include everyone who filed.
  const hasPrimaryWinners = candidatesRaw.some((c) => c.primary_winner);
  const candidates: PresCandidate[] = candidatesRaw
    .filter((c) => !hasPrimaryWinners || c.primary_winner)
    .map((c) => ({
      id: c.id,
      user_id: c.user_id,
      party: c.party,
      created_at: c.created_at,
    }));

  const states: PresStateMeta[] = (statesData ?? []).map((s) => {
    const code = s.code.toUpperCase();
    const ev =
      typeof s.electoral_votes === "number" && s.electoral_votes > 0
        ? s.electoral_votes
        : (FALLBACK_EV[code] ?? 0);
    return {
      code,
      name: s.name,
      pvi: Number(s.pvi ?? 0),
      electoral_votes: ev,
    };
  });

  const votes: PresVote[] = ((votesRes.data ?? []) as Array<{
    candidate_id: string;
    voter_state: string | null;
  }>).map((v) => ({
    candidate_id: v.candidate_id,
    voter_state: v.voter_state ? v.voter_state.toUpperCase() : null,
  }));

  const speeches = ((speechesRes.data ?? []) as Array<{
    candidate_id: string;
    target_state: string | null;
    points: number | null;
  }>).map((s) => ({
    candidate_id: s.candidate_id,
    target_state: s.target_state ? s.target_state.toUpperCase() : null,
    points: Number(s.points ?? 0),
  }));
  const rallies = ((ralliesRes.data ?? []) as Array<{
    candidate_id: string;
    target_state: string | null;
    points: number | null;
  }>).map((r) => ({
    candidate_id: r.candidate_id,
    target_state: r.target_state ? r.target_state.toUpperCase() : null,
    points: Number(r.points ?? 0),
  }));
  const events: PresCampaignEvent[] = [...speeches, ...rallies];

  return { candidates, states, votes, events };
}

export function scorePresidentialBundle(
  bundle: PresidentialDataBundle,
): PresidentialResult {
  return scorePresidentialElection(
    bundle.candidates,
    bundle.states,
    bundle.votes,
    bundle.events,
  );
}
