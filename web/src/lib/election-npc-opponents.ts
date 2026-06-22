import type { SupabaseClient } from "@supabase/supabase-js";
import { throwIfPostgrestError } from "@/lib/supabase-error";

/** Seed Democrat + Republican NPC placeholders for a seat race. */
export async function seedElectionNpcOpponents(
  supabase: SupabaseClient,
  electionId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("seed_election_npc_opponents", {
    p_election_id: electionId,
  });
  throwIfPostgrestError(error);
  return Boolean(data);
}

/** After primary voting: player winners replace party NPCs; vacant parties keep their NPC. */
export async function finalizeElectionPartyNominees(
  supabase: SupabaseClient,
  electionId: string,
): Promise<void> {
  const { error } = await supabase.rpc("finalize_election_party_nominees", {
    p_election_id: electionId,
  });
  throwIfPostgrestError(error);
}
