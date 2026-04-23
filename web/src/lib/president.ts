import type { SupabaseClient } from "@supabase/supabase-js";

/** President via Discord sync (`government_role_grants`) or legacy `profiles.office_role`. */
export async function isPresident(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data: grant } = await supabase
    .from("government_role_grants")
    .select("role_key")
    .eq("user_id", userId)
    .eq("role_key", "president")
    .maybeSingle();
  if (grant) return true;
  const { data: prof } = await supabase.from("profiles").select("office_role").eq("id", userId).maybeSingle();
  return (prof as { office_role?: string } | null)?.office_role === "president";
}
