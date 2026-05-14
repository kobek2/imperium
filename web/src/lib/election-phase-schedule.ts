import type { SupabaseClient } from "@supabase/supabase-js";

export type RunElectionPhaseScheduleOpts = {
  /** When true, always runs the advance RPCs (e.g. after a player or admin mutation). Ignores `calendar_auto_congress_elections`. */
  force?: boolean;
};

/**
 * Applies scheduled election phase transitions in the database (RPC, security definer).
 * Keep logic in sync with migration `20260420090000_election_auto_phase_schedule.sql` and
 * `endPrimarySelectWinners` in `app/actions/elections.ts` (same vote-based winner rules).
 *
 * Also auto-closes any leadership sessions whose 24h window has elapsed (migration
 * `20260428000000_leadership_sessions.sql`).
 *
 * When `simulation_settings.calendar_auto_congress_elections` is false, this no-ops unless
 * `opts.force` is set (pass force from server actions after writes).
 */
export async function runElectionPhaseSchedule(
  supabase: SupabaseClient,
  opts?: RunElectionPhaseScheduleOpts,
): Promise<void> {
  if (!opts?.force) {
    const { data: row, error: readErr } = await supabase
      .from("simulation_settings")
      .select("calendar_auto_congress_elections")
      .eq("id", 1)
      .maybeSingle();
    if (readErr) {
      console.warn("[runElectionPhaseSchedule] settings read:", readErr.message);
      return;
    }
    const auto = Boolean((row as { calendar_auto_congress_elections?: boolean } | null)?.calendar_auto_congress_elections);
    if (!auto) return;
  }

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
