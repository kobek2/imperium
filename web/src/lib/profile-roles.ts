import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient;
import { mergeRoleKeys } from "@/lib/role-capabilities";

type MinimalProfile = {
  office_role: string | null;
};

export async function fetchEffectiveRoleKeys(
  supabase: Db,
  userId: string,
  profile: MinimalProfile | null,
): Promise<string[]> {
  const { data: grants } = await supabase
    .from("government_role_grants")
    .select("role_key")
    .eq("user_id", userId);

  const keys = grants?.map((g) => g.role_key).filter(Boolean) ?? [];
  return mergeRoleKeys(keys, profile?.office_role ?? null);
}
