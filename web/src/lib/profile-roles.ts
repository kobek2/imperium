import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient;
type MinimalProfile = {
  office_role?: string | null;
};

/** Baseline sim: government_role_grants are the single source of truth for offices. */
export async function fetchEffectiveRoleKeys(
  supabase: Db,
  userId: string,
  _profile?: MinimalProfile | null,
): Promise<string[]> {
  const { data: grants } = await supabase
    .from("government_role_grants")
    .select("role_key")
    .eq("user_id", userId);

  const keys = grants?.map((g) => String(g.role_key ?? "").trim()).filter(Boolean) ?? [];
  return [...new Set(keys)];
}
