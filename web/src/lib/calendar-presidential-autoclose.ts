import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPresidentialBundle, scorePresidentialBundle } from "@/lib/presidential-data";

/**
 * Auto-certifies calendar-created president races (general phase, past close, EC math ready).
 * Does not touch races without calendar_cycle_key starting with `presidential_`.
 */
export async function autoCloseCalendarPresidentElectionsIfDue(supabase: SupabaseClient): Promise<void> {
  const { data: rows } = await supabase
    .from("elections")
    .select("id")
    .eq("office", "president")
    .eq("phase", "general")
    .not("calendar_cycle_key", "is", null)
    .like("calendar_cycle_key", "presidential_%")
    .lte("general_closes_at", new Date().toISOString());

  for (const row of rows ?? []) {
    const id = String((row as { id: string }).id);
    const bundle = await loadPresidentialBundle(supabase, id);
    const scored = scorePresidentialBundle(bundle);
    if (!scored.winnerCandidateId) continue;

    const winner = bundle.candidates.find((c) => c.id === scored.winnerCandidateId);
    if (!winner?.user_id) continue;

    const { error: upErr } = await supabase
      .from("elections")
      .update({ phase: "closed", winner_user_id: winner.user_id })
      .eq("id", id)
      .eq("phase", "general");
    if (upErr) {
      console.warn("[calendar] auto-close president", id, upErr.message);
      continue;
    }

    const { error: roleErr } = await supabase.rpc("calendar_apply_election_role_transitions", {
      p_election_id: id,
    });
    if (roleErr) console.warn("[calendar] president role transitions", id, roleErr.message);
  }
}
