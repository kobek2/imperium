import type { SupabaseClient } from "@supabase/supabase-js";

/** NPC seeding disabled in simplified sim. */
export async function seedElectionNpcOpponents(
  _supabase: SupabaseClient,
  _electionId: string,
): Promise<boolean> {
  return false;
}
