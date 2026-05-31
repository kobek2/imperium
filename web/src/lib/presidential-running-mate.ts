import type { SupabaseClient } from "@supabase/supabase-js";

/** Baseline sim: no presidential running mates or VP tie-break campaign restrictions. */
export async function isActivePresidentialRunningMate(
  _supabase: SupabaseClient,
  _userId: string,
): Promise<boolean> {
  return false;
}

export async function userCanBreakSenateTie(
  _supabase: SupabaseClient,
  _userId: string,
  roleKeys: string[],
): Promise<boolean> {
  return roleKeys.includes("vice_president") || roleKeys.includes("admin");
}
