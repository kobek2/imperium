import type { SupabaseClient } from "@supabase/supabase-js";

export type RunElectionPhaseScheduleOpts = {
  /** @deprecated Ignored — elections are admin-driven only. */
  force?: boolean;
};

/**
 * Elections advance only via admin actions (`setElectionPhase`, finalize helpers).
 * The database RPC `advance_election_phases_by_schedule` is a no-op after simplification.
 */
export async function runElectionPhaseSchedule(
  _supabase: SupabaseClient,
  _opts?: RunElectionPhaseScheduleOpts,
): Promise<void> {
  /* manual-only */
}
