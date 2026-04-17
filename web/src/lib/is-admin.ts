import { createClient, tryCreateClient } from "@/lib/supabase/server";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";

export async function getIsAdmin(): Promise<boolean> {
  const supabase = await tryCreateClient();
  if (!supabase) return false;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();
  const keys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  return keys.includes("admin");
}

export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();
  const keys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!keys.includes("admin")) throw new Error("Admin only");
  return { supabase, user };
}
