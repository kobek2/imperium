import type { SupabaseClient } from "@supabase/supabase-js";
import { isCityElectionOffice, NYC_CITY_CODE } from "@/lib/city";

/** Seat the player when a closed city race won but role transitions failed earlier. */
export async function ensureCityElectionSeatingForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: races } = await supabase
    .from("elections")
    .select("id")
    .eq("phase", "closed")
    .eq("winner_user_id", userId)
    .eq("state", NYC_CITY_CODE)
    .in("office", ["council_ward", "mayor"]);

  for (const race of races ?? []) {
    const { error } = await supabase.rpc("ensure_city_election_seating", {
      p_election_id: race.id,
    });
    if (error) {
      console.warn("[ensureCityElectionSeatingForUser]", race.id, error.message);
    }
  }
}

export async function ensureCityElectionSeating(
  supabase: SupabaseClient,
  election: {
    id: string;
    phase: string;
    office: string;
    state: string | null;
    winner_user_id: string | null;
  },
  userId: string,
): Promise<void> {
  if (election.phase !== "closed") return;
  if (election.winner_user_id !== userId) return;
  if (!isCityElectionOffice(election.office) || election.state !== NYC_CITY_CODE) return;

  const { error } = await supabase.rpc("ensure_city_election_seating", {
    p_election_id: election.id,
  });
  if (error) {
    console.warn("[ensureCityElectionSeating]", election.id, error.message);
  }
}
