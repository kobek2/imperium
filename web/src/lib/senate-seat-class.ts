import type { SupabaseClient } from "@supabase/supabase-js";

/** Most recent closed Senate seat the user won (seat 1, 2, or 3 within a region). */
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
 * Next Senate seat (1–3) for a region that does not already have a non-closed seat race for that seat.
 */
export async function pickNextSenateClassForState(
  supabase: SupabaseClient,
  regionCode: string,
): Promise<number | null> {
  const st = regionCode.trim().toUpperCase();
  if (!["NE", "SO", "WE"].includes(st)) return null;
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
