import type { SupabaseClient } from "@supabase/supabase-js";

export type RunElectionPhaseScheduleOpts = {
  /** @deprecated Kept for call-site compatibility; schedule always runs when invoked. */
  force?: boolean;
};

/**
 * Closes overdue election phases via `advance_election_phases_by_schedule`.
 * Safe to call on every authenticated page load — the RPC is idempotent.
 */
export async function runElectionPhaseSchedule(
  supabase: SupabaseClient,
  _opts?: RunElectionPhaseScheduleOpts,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("advance_election_phases_by_schedule");
    if (error) {
      console.error("[election-phase-schedule]", error.message);
    }
  } catch (err) {
    console.error("[election-phase-schedule]", err);
  }
}
