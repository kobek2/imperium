import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Applies scheduled election phase transitions in the database (RPC, security definer).
 * Keep logic in sync with migration `20260420090000_election_auto_phase_schedule.sql` and
 * `endPrimarySelectWinners` in `app/actions/elections.ts` (same vote-based winner rules).
 */
export async function runElectionPhaseSchedule(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("advance_election_phases_by_schedule");
  if (error) {
    console.warn("[runElectionPhaseSchedule]", error.message);
  }
}
