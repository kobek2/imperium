/**
 * Server-side helper that gathers everything needed to score a presidential race:
 * candidates, states (with PVI + electoral_votes), general votes, and campaign events.
 *
 * Used by both `finalizePresident` (server action) and the `/elections/[id]` page
 * so the admin-certified winner and the live map agree on the math.
 */

import { createClient as createServiceSupabaseClient } from "@supabase/supabase-js";
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

const NATIONAL_PRESIDENTIAL_ENDORSEMENT_ROLES = new Set<string>([
  "speaker",
  "president_pro_tempore",
  "senate_majority_leader",
  "senate_minority_leader",
  "house_majority_leader",
  "house_minority_leader",
]);

function looksLikeMissingEvColumn(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("electoral_votes");
}

/**
 * Presidential scoring must match raw Postgres. When `SUPABASE_SERVICE_ROLE_KEY` is set
 * (server only — never NEXT_PUBLIC_*), read the bundle with the service client so RLS /
 * JWT presentation cannot return empty `campaign_ads` while SQL in the dashboard shows rows.
 */
function readerForPresidentialBundle(userClient: SupabaseClient): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return userClient;
  return createServiceSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** PostgREST default max rows per request (Supabase dashboard can raise it; we paginate instead). */
const REST_PAGE_SIZE = 1000;

type PagedElectionTable =
  | "general_votes"
  | "campaign_speeches"
  | "campaign_rallies"
  | "campaign_ads"
  | "campaign_endorsements";

async function fetchAllRowsForElection(
  db: SupabaseClient,
  table: PagedElectionTable,
  selectColumns: string,
  election_id: string,
): Promise<{ data: unknown[] | null; error: { message: string } | null }> {
  const out: unknown[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from(table)
      .select(selectColumns)
      .eq("election_id", election_id)
      .order("created_at", { ascending: true })
      .range(from, from + REST_PAGE_SIZE - 1);
    if (error) return { data: null, error };
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < REST_PAGE_SIZE) break;
    from += REST_PAGE_SIZE;
  }
  return { data: out, error: null };
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
  const db = readerForPresidentialBundle(supabase);
  const [
    candidatesRes,
    votesRes,
    speechesRes,
    ralliesRes,
    adsRes,
    endorsementsRes,
    statesRes,
  ] = await Promise.all([
    db
      .from("election_candidates")
      .select("id, user_id, party, primary_winner, created_at")
      .eq("election_id", election_id),
    fetchAllRowsForElection(db, "general_votes", "candidate_id, voter_state", election_id),
    fetchAllRowsForElection(db, "campaign_speeches", "candidate_id, target_state, points", election_id),
    fetchAllRowsForElection(db, "campaign_rallies", "candidate_id, target_state, points", election_id),
    fetchAllRowsForElection(db, "campaign_ads", "candidate_id, target_state, points", election_id),
    fetchAllRowsForElection(
      db,
      "campaign_endorsements",
      "candidate_id, endorser_user_id, role_key, points",
      election_id,
    ),
    db
      .from("states")
      .select("code, name, pvi, electoral_votes")
      .order("code"),
  ]);

  for (const [label, res] of [
    ["election_candidates", candidatesRes],
    ["general_votes", votesRes],
    ["campaign_speeches", speechesRes],
    ["campaign_rallies", ralliesRes],
    ["campaign_ads", adsRes],
    ["campaign_endorsements", endorsementsRes],
  ] as const) {
    if (res.error) {
      console.warn(`[loadPresidentialBundle] ${label} (${election_id}):`, res.error.message);
    }
  }

  if (process.env.NODE_ENV === "development") {
    const svc = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
    const n = adsRes.data?.length ?? 0;
    const err = adsRes.error?.message ?? "";
    console.info(
      `[loadPresidentialBundle] ${election_id} reader=${svc ? "service_role" : "user_jwt_only"} campaign_ads_rows=${n}${err ? ` error=${err}` : ""}`,
    );
  }

  /** Normalize DB `char(n)` / text so state keys match cartogram codes (e.g. "MN"). */
  function normalizeStateCode(raw: string | null | undefined): string | null {
    if (raw == null || raw === "") return null;
    const t = String(raw).trim().toUpperCase();
    return t.length ? t : null;
  }

  let statesData = statesRes.data as
    | Array<{ code: string; name: string; pvi: number | null; electoral_votes?: number | null }>
    | null;
  if (statesRes.error && looksLikeMissingEvColumn(statesRes.error.message)) {
    const retry = await db
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
    voter_state: normalizeStateCode(v.voter_state),
  }));

  const speeches = ((speechesRes.data ?? []) as Array<{
    candidate_id: string;
    target_state: string | null;
    points: number | null;
  }>).map((s) => ({
    candidate_id: s.candidate_id,
    target_state: normalizeStateCode(s.target_state),
    points: Number(s.points ?? 0),
  }));
  const rallies = ((ralliesRes.data ?? []) as Array<{
    candidate_id: string;
    target_state: string | null;
    points: number | null;
  }>).map((r) => ({
    candidate_id: r.candidate_id,
    target_state: normalizeStateCode(r.target_state),
    points: Number(r.points ?? 0),
  }));
  const endorsementsRaw = (endorsementsRes.data ?? []) as Array<{
    candidate_id: string;
    endorser_user_id: string;
    role_key: string | null;
    points: number | null;
  }>;

  const endorserIds = [...new Set(endorsementsRaw.map((e) => e.endorser_user_id))];
  const endorserStateById = new Map<string, string | null>();
  if (endorserIds.length > 0) {
    const { data: endorserProfiles } = await db
      .from("profiles")
      .select("id, residence_state, home_district_code")
      .in("id", endorserIds);
    for (const p of endorserProfiles ?? []) {
      const derivedState =
        (p.residence_state ? String(p.residence_state).toUpperCase() : null) ??
        (p.home_district_code ? String(p.home_district_code).slice(0, 2).toUpperCase() : null);
      endorserStateById.set(p.id, derivedState);
    }
  }

  const endorsements: PresCampaignEvent[] = endorsementsRaw.map((e) => {
    const roleKey = String(e.role_key ?? "");
    const national = NATIONAL_PRESIDENTIAL_ENDORSEMENT_ROLES.has(roleKey);
    const endorserState = endorserStateById.get(e.endorser_user_id) ?? null;
    return {
      candidate_id: e.candidate_id,
      // Presidential endorsements are state-scoped unless the endorser holds selected
      // congressional leadership roles, in which case they contribute nationally.
      target_state: national ? null : endorserState,
      points: Number(e.points ?? 0),
      is_national: national,
    };
  });

  const ads = ((adsRes.data ?? []) as Array<{
    candidate_id: string;
    target_state: string | null;
    points: number | null;
  }>).map((a) => ({
    candidate_id: a.candidate_id,
    target_state: normalizeStateCode(a.target_state),
    points: Number(a.points ?? 0),
  }));

  const scoredCandidateIds = new Set(candidates.map((c) => c.id));
  const orphanAdPts = ads
    .filter((a) => !scoredCandidateIds.has(a.candidate_id))
    .reduce((s, a) => s + a.points, 0);
  if (orphanAdPts > 0) {
    const orphanIds = [...new Set(ads.filter((a) => !scoredCandidateIds.has(a.candidate_id)).map((a) => a.candidate_id))];
    console.warn(
      `[loadPresidentialBundle] ${orphanAdPts} campaign ad point(s) use candidate_id not on the general ballot (nominee filter). ` +
        `They are ignored by the electoral map. Orphan candidate_id(s): ${orphanIds.slice(0, 6).join(", ")}`,
    );
  }

  const events: PresCampaignEvent[] = [...speeches, ...rallies, ...ads, ...endorsements];

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
