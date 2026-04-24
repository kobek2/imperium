import { createClient, getServerAuth } from "@/lib/supabase/server";
import type { StaffProfileOfficeRow } from "@/lib/staff-access";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";

/** @param officeProfile — when supplied, skips a duplicate `profiles` fetch (e.g. combined with staff access). */
export async function getIsAdmin(officeProfile?: StaffProfileOfficeRow | null): Promise<boolean> {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) return false;

  let profile: StaffProfileOfficeRow | null;
  if (officeProfile !== undefined) {
    profile = officeProfile;
  } else {
    const { data } = await supabase
      .from("profiles")
      .select("office_role")
      .eq("id", user.id)
      .maybeSingle();
    profile = data ?? null;
  }

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
