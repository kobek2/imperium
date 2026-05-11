import type { SupabaseClient } from "@supabase/supabase-js";

export type SeatElectionRow = {
  id: string;
  office: string;
  state: string | null;
  district_code: string | null;
  senate_class: number | null;
  winner_user_id: string | null;
};

export async function rpcApplyElectionSeating(supabase: SupabaseClient, electionId: string): Promise<void> {
  const { error } = await supabase.rpc("calendar_apply_election_role_transitions", {
    p_election_id: electionId,
  });
  if (error) {
    console.warn("[calendar] calendar_apply_election_role_transitions", electionId, error.message);
  }
}

export async function markElectionCalendarSeated(supabase: SupabaseClient, electionId: string): Promise<void> {
  await supabase
    .from("elections")
    .update({ calendar_seated_at: new Date().toISOString() })
    .eq("id", electionId);
}

async function revokeRepresentative(supabase: SupabaseClient, userId: string): Promise<void> {
  await supabase.from("government_role_grants").delete().eq("user_id", userId).eq("role_key", "representative");
  await supabase
    .from("profiles")
    .update({ office_role: null, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .eq("office_role", "representative");
}

async function revokeSenator(supabase: SupabaseClient, userId: string): Promise<void> {
  await supabase.from("government_role_grants").delete().eq("user_id", userId).eq("role_key", "senator");
  await supabase
    .from("profiles")
    .update({ office_role: null, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .eq("office_role", "senator");
}

/** Anyone with this district as home who is not the new winner loses the House seat. */
export async function vacateHouseDistrictExceptWinner(
  supabase: SupabaseClient,
  districtCode: string,
  winnerUserId: string | null,
): Promise<void> {
  const d = districtCode.trim().toUpperCase();
  if (!d) return;

  const { data: rows } = await supabase
    .from("profiles")
    .select("id")
    .eq("home_district_code", d);

  for (const row of rows ?? []) {
    const uid = String((row as { id: string }).id);
    if (winnerUserId && uid === winnerUserId) continue;
    await revokeRepresentative(supabase, uid);
  }
}

/** Prior winner for the same district in a different closed election loses the seat if someone else won. */
export async function vacatePriorHouseWinnerIfReplaced(
  supabase: SupabaseClient,
  districtCode: string,
  currentElectionId: string,
  newWinnerId: string | null,
): Promise<void> {
  const d = districtCode.trim().toUpperCase();
  const { data: prior } = await supabase
    .from("elections")
    .select("id, winner_user_id")
    .eq("office", "house")
    .eq("district_code", d)
    .eq("phase", "closed")
    .neq("id", currentElectionId)
    .not("winner_user_id", "is", null)
    .order("general_closes_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const old = prior?.winner_user_id as string | null | undefined;
  if (!old) return;
  if (newWinnerId && old === newWinnerId) return;
  if (newWinnerId && old !== newWinnerId) await revokeRepresentative(supabase, old);
  if (!newWinnerId) await revokeRepresentative(supabase, old);
}

export async function vacatePriorSenateWinnerIfReplaced(
  supabase: SupabaseClient,
  state: string,
  senateClass: number,
  currentElectionId: string,
  newWinnerId: string | null,
): Promise<void> {
  const st = state.trim().toUpperCase();
  const { data: prior } = await supabase
    .from("elections")
    .select("winner_user_id")
    .eq("office", "senate")
    .eq("state", st)
    .eq("senate_class", senateClass)
    .eq("phase", "closed")
    .neq("id", currentElectionId)
    .not("winner_user_id", "is", null)
    .order("general_closes_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const old = prior?.winner_user_id as string | null | undefined;
  if (!old) return;
  if (newWinnerId && old === newWinnerId) return;
  if (newWinnerId && old !== newWinnerId) await revokeSenator(supabase, old);
  if (!newWinnerId) await revokeSenator(supabase, old);
}

export async function processSeatElectionCalendarSeating(
  supabase: SupabaseClient,
  row: SeatElectionRow,
): Promise<void> {
  if (row.winner_user_id) {
    await rpcApplyElectionSeating(supabase, row.id);
  }

  if (row.office === "house" && row.district_code) {
    await vacatePriorHouseWinnerIfReplaced(supabase, row.district_code, row.id, row.winner_user_id);
    await vacateHouseDistrictExceptWinner(supabase, row.district_code, row.winner_user_id);
  } else if (row.office === "senate" && row.state && row.senate_class != null) {
    await vacatePriorSenateWinnerIfReplaced(
      supabase,
      row.state,
      row.senate_class,
      row.id,
      row.winner_user_id,
    );
  }

  await markElectionCalendarSeated(supabase, row.id);
}

/** Calendar-created seat races: wall-clock phase lengths. RP months advance separately via {@link RP_MONTHS_PER_REAL_DAY}. */
export type SeatRaceSchedule = {
  filing_opens_at: string;
  filing_closes_at: string;
  primary_closes_at: string;
  general_closes_at: string;
};

/** House, Senate, and President calendar races: 24h filing, 24h primary, 24h general (72h total). */
export function seatRaceScheduleFromNow(): SeatRaceSchedule {
  const t0 = Date.now();
  const msHour = 60 * 60 * 1000;
  const filingH = 24;
  const primaryH = 24;
  const generalH = 24;
  const filing_opens_at = new Date(t0).toISOString();
  const filing_closes_at = new Date(t0 + filingH * msHour).toISOString();
  const primary_closes_at = new Date(t0 + (filingH + primaryH) * msHour).toISOString();
  const general_closes_at = new Date(t0 + (filingH + primaryH + generalH) * msHour).toISOString();
  return { filing_opens_at, filing_closes_at, primary_closes_at, general_closes_at };
}

export function leadershipRaceScheduleFromNow(): {
  filing_opens_at: string;
  filing_closes_at: string;
  general_closes_at: string;
} {
  const opens = new Date();
  const filing_closes_at = new Date(opens.getTime() + 60 * 60 * 1000).toISOString();
  const general_closes_at = new Date(opens.getTime() + 25 * 60 * 60 * 1000).toISOString();
  return {
    filing_opens_at: opens.toISOString(),
    filing_closes_at,
    general_closes_at,
  };
}
