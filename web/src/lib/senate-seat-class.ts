import type { SupabaseClient } from "@supabase/supabase-js";

/** Most recent closed Senate seat the user won (class identifies which of the state's three seats). */
export async function fetchUserSenateClassHeld(
  supabase: SupabaseClient,
  userId: string,
): Promise<number | null> {
  const { data } = await supabase
    .from("elections")
    .select("senate_class")
    .eq("office", "senate")
    .eq("winner_user_id", userId)
    .eq("phase", "closed")
    .is("leadership_role", null)
    .not("senate_class", "is", null)
    .order("general_closes_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const raw = (data as { senate_class?: number | null } | null)?.senate_class;
  if (raw == null || Number.isNaN(Number(raw))) return null;
  const n = Number(raw);
  return n >= 1 && n <= 3 ? n : null;
}

/**
 * Next Senate class (1–3) for a state that does not already have a non-closed seat race for that class.
 * Returns null if all three classes already have an open seat election.
 */
export async function pickNextSenateClassForState(
  supabase: SupabaseClient,
  state: string,
): Promise<number | null> {
  const st = state.trim().toUpperCase();
  if (st.length !== 2) return null;
  const { data: rows } = await supabase
    .from("elections")
    .select("senate_class")
    .eq("office", "senate")
    .eq("state", st)
    .neq("phase", "closed")
    .is("leadership_role", null)
    .not("senate_class", "is", null);
  const used = new Set(
    (rows ?? [])
      .map((r) => Number((r as { senate_class?: number }).senate_class))
      .filter((n) => n >= 1 && n <= 3),
  );
  for (const c of [1, 2, 3] as const) {
    if (!used.has(c)) return c;
  }
  return null;
}
