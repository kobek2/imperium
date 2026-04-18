import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Applies scheduled election phase transitions in the database (RPC, security definer).
 * Keep logic in sync with migration `20260420090000_election_auto_phase_schedule.sql` and
 * `endPrimarySelectWinners` in `app/actions/elections.ts` (same vote-based winner rules).
 *
 * Also auto-closes any leadership sessions whose 24h window has elapsed (migration
 * `20260428000000_leadership_sessions.sql`).
 */
export async function runElectionPhaseSchedule(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("advance_election_phases_by_schedule");
  if (error) {
    console.warn("[runElectionPhaseSchedule]", error.message);
  }
  const { error: leadershipErr } = await supabase.rpc("advance_leadership_sessions_by_schedule");
  if (leadershipErr) {
    // Tolerate missing function on older DBs; just log.
    console.warn("[runLeadershipSessionSchedule]", leadershipErr.message);
  }
}
