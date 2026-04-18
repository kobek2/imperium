import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * True when this user is a presidential running mate on an open primary ticket.
 * Used to block Senate floor votes (except tie-break) and filing legislation.
 */
export async function isActivePresidentialRunningMate(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data: rows } = await supabase
    .from("election_candidates")
    .select("election_id")
    .eq("running_mate_user_id", userId)
    .limit(50);

  if (!rows?.length) return false;

  const electionIds = [...new Set(rows.map((r) => r.election_id as string))];
  const { data: elections } = await supabase
    .from("elections")
    .select("id, office, phase, primary_closes_at")
    .in("id", electionIds);

  const now = Date.now();
  for (const e of elections ?? []) {
    if (e.office !== "president" || e.phase !== "primary") continue;
    if (e.primary_closes_at && new Date(e.primary_closes_at).getTime() < now) continue;
    return true;
  }
  return false;
}

export async function userCanBreakSenateTie(
  supabase: SupabaseClient,
  userId: string,
  roleKeys: string[],
): Promise<boolean> {
  if (roleKeys.includes("admin") || roleKeys.includes("vice_president")) return true;
  return isActivePresidentialRunningMate(supabase, userId);
}

/** The ticket row (candidate id) this user campaigns for on a president race, if any. */
export async function resolvePresidentTicketCandidate(
  supabase: SupabaseClient,
  electionId: string,
  userId: string,
): Promise<{ id: string } | null> {
  const { data: asHead } = await supabase
    .from("election_candidates")
    .select("id")
    .eq("election_id", electionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (asHead?.id) return { id: asHead.id };

  const { data: asMate } = await supabase
    .from("election_candidates")
    .select("id")
    .eq("election_id", electionId)
    .eq("running_mate_user_id", userId)
    .maybeSingle();
  if (asMate?.id) return { id: asMate.id };

  return null;
}
