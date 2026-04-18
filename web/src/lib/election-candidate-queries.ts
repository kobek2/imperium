import type { SupabaseClient } from "@supabase/supabase-js";

export type ElectionCandidateListRow = {
  id: string;
  party: string;
  campaign_points_total: number | null;
  user_id: string;
  primary_winner: boolean | null;
  created_at: string | null;
  running_mate_user_id: string | null;
};

const BASE =
  "id, party, campaign_points_total, user_id, primary_winner, created_at" as const;
const WITH_MATE = `${BASE}, running_mate_user_id` as const;

/** True when PostgREST/Postgres is complaining about `running_mate_user_id` (migration not applied). */
export function looksLikeMissingRunningMateColumn(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("running_mate") ||
    m.includes("schema cache") ||
    (m.includes("column") && m.includes("does not exist"))
  );
}

/**
 * Loads candidates for an election detail/listing. If the DB has not had the
 * `running_mate_user_id` migration yet, retries without that column so the page
 * still renders filed candidates.
 */
export async function fetchElectionCandidatesForListing(
  supabase: SupabaseClient,
  electionId: string,
): Promise<ElectionCandidateListRow[]> {
  const preferred = await supabase
    .from("election_candidates")
    .select(WITH_MATE)
    .eq("election_id", electionId)
    .order("id", { ascending: true });

  if (!preferred.error) {
    return (preferred.data ?? []) as ElectionCandidateListRow[];
  }

  if (
    !looksLikeMissingRunningMateColumn(preferred.error.message) &&
    preferred.error.code !== "PGRST204"
  ) {
    console.warn("[fetchElectionCandidatesForListing]", preferred.error.message);
  }

  const fallback = await supabase
    .from("election_candidates")
    .select(BASE)
    .eq("election_id", electionId)
    .order("id", { ascending: true });

  if (fallback.error) {
    console.warn("[fetchElectionCandidatesForListing] fallback:", fallback.error.message);
    return [];
  }

  return (fallback.data ?? []).map((row) => ({
    ...(row as Omit<ElectionCandidateListRow, "running_mate_user_id">),
    running_mate_user_id: null,
  }));
}
