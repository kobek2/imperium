import type { SupabaseClient } from "@supabase/supabase-js";

export type ElectionCandidateListRow = {
  id: string;
  party: string;
  campaign_points_total: number | null;
  user_id: string | null;
  primary_winner: boolean | null;
  created_at: string | null;
  running_mate_user_id: string | null;
  is_npc?: boolean | null;
  npc_name?: string | null;
  npc_synthetic_votes?: number | null;
};

const BASE =
  "id, party, campaign_points_total, user_id, primary_winner, created_at, is_npc, npc_name, npc_synthetic_votes" as const;
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

/**
 * Request window for each PostgREST page. Use 1000 to match local `supabase/config.toml` max_rows;
 * pagination advances by **actual** `batch.length` so a lower hosted `max_rows` still returns every row.
 */
const POSTGREST_PAGE = 1000;

export type ElectionCandidateSummaryRow = {
  election_id: string;
  primary_winner: boolean | null;
};

async function fetchCandidateSummaryRowsForOneElection(
  supabase: SupabaseClient,
  electionId: string,
): Promise<ElectionCandidateSummaryRow[]> {
  const acc: ElectionCandidateSummaryRow[] = [];
  let from = 0;
  for (let page = 0; page < 500; page++) {
    const { data, error } = await supabase
      .from("election_candidates")
      .select("election_id, primary_winner")
      .eq("election_id", electionId)
      .order("id", { ascending: true })
      .range(from, from + POSTGREST_PAGE - 1);

    if (error) {
      console.warn("[fetchElectionCandidateSummaryRows]", electionId, error.message);
      break;
    }

    const batch = (data ?? []) as ElectionCandidateSummaryRow[];
    if (batch.length === 0) break;
    acc.push(...batch);
    from += batch.length;
  }
  return acc;
}

/**
 * Loads every `election_candidates` row for the given elections (for dashboard counts).
 *
 * Uses one scoped query per election (batched in parallel) instead of a single `.in(election_id, …)`
 * so we never lose rows to: PostgREST `max_rows` spread across many races, long filter URLs, or
 * stopping pagination early when a page returns fewer rows than requested.
 */
export async function fetchElectionCandidateSummaryRows(
  supabase: SupabaseClient,
  electionIds: string[],
): Promise<ElectionCandidateSummaryRow[]> {
  if (electionIds.length === 0) return [];
  const acc: ElectionCandidateSummaryRow[] = [];
  const concurrency = 25;
  for (let i = 0; i < electionIds.length; i += concurrency) {
    const slice = electionIds.slice(i, i + concurrency);
    const parts = await Promise.all(
      slice.map((id) => fetchCandidateSummaryRowsForOneElection(supabase, id)),
    );
    for (const rows of parts) {
      acc.push(...rows);
    }
  }
  return acc;
}

/**
 * Card headline count for `/elections`: same rules as `generalCandidates` in
 * `election-detail.tsx` — general/closed use nominees when `primary_winner` flags exist, else all
 * filed rows; filing/primary count everyone filed.
 */
export function candidateCountForElectionDashboard(
  phase: string,
  rows: Array<{ primary_winner: boolean | null }>,
): number {
  const all = rows.length;
  if (phase !== "general" && phase !== "closed") return all;
  const hasPrimaryWinners = rows.some((r) => r.primary_winner);
  if (!hasPrimaryWinners) return all;
  return rows.filter((r) => r.primary_winner).length;
}

/** Raw filed-candidate totals (admin list, archive) — one exact count per race, no row caps. */
export async function countElectionCandidatesByElectionIds(
  supabase: SupabaseClient,
  electionIds: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (electionIds.length === 0) return out;
  const concurrency = 25;
  for (let i = 0; i < electionIds.length; i += concurrency) {
    const slice = electionIds.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async (electionId) => {
        const { count, error } = await supabase
          .from("election_candidates")
          .select("id", { count: "exact", head: true })
          .eq("election_id", electionId);
        if (error) {
          console.warn("[countElectionCandidatesByElectionIds]", electionId, error.message);
          return;
        }
        out[electionId] = count ?? 0;
      }),
    );
  }
  return out;
}
