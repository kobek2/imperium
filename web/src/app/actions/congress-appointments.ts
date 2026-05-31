"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStaffMayAccessElectionsConsole } from "@/lib/staff-access";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { isLeadershipRole } from "@/lib/leadership";
import { hasFullStaffAccess } from "@/lib/staff-permissions";

export type AppointmentProfileHit = {
  id: string;
  character_name: string;
  discord_username: string | null;
  residence_state: string | null;
  home_district_code: string | null;
};

async function requireElectionConsoleSupabase() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  if (!(await getStaffMayAccessElectionsConsole())) throw new Error("Forbidden");
  return { supabase };
}

async function requireFullStaffSupabase() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  if (!(await getStaffMayAccessElectionsConsole())) throw new Error("Forbidden");
  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const keys = await fetchEffectiveRoleKeys(supabase, user.id, profile ?? null);
  if (!hasFullStaffAccess(keys)) {
    throw new Error("Only full staff (admin or staff_super) may run seat and leadership appointments.");
  }
  return { supabase };
}

function sanitizeIlikeFragment(q: string): string {
  return q.replace(/\\/g, "").replace(/%/g, "").replace(/_/g, "").trim();
}

export async function searchProfilesForAppointment(query: string): Promise<AppointmentProfileHit[]> {
  const { supabase } = await requireElectionConsoleSupabase();
  const s = sanitizeIlikeFragment(query);
  if (s.length < 2) return [];
  const pattern = `%${s}%`;
  const [{ data: byName, error: e1 }, { data: byDiscord, error: e2 }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, character_name, discord_username, residence_state, home_district_code")
      .ilike("character_name", pattern)
      .order("character_name", { ascending: true })
      .limit(20),
    supabase
      .from("profiles")
      .select("id, character_name, discord_username, residence_state, home_district_code")
      .ilike("discord_username", pattern)
      .order("character_name", { ascending: true })
      .limit(20),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  const byId = new Map<string, AppointmentProfileHit>();
  for (const r of [...(byName ?? []), ...(byDiscord ?? [])]) {
    const row = r as AppointmentProfileHit;
    byId.set(row.id, row);
  }
  return [...byId.values()]
    .sort((a, b) => a.character_name.localeCompare(b.character_name))
    .slice(0, 20);
}

function revalidateCongressAndDirectory() {
  revalidatePath("/admin/elections");
  revalidatePath("/directory");
  revalidatePath("/congress");
  revalidatePath("/congress/leadership");
  revalidatePath("/character");
  revalidatePath("/oval");
  revalidatePath("/economy");
  revalidatePath("/economy/federal");
  revalidatePath("/imperium");
}

export async function appointHouseSeatForProfile(userId: string): Promise<void> {
  const { supabase } = await requireFullStaffSupabase();
  const { error } = await supabase.rpc("admin_appoint_house_seat", { p_user_id: userId });
  if (error) throw new Error(error.message);
  revalidateCongressAndDirectory();
}

export async function appointSenateSeatForProfile(
  userId: string,
  state: string,
  senateClass: 1 | 2 | 3,
): Promise<void> {
  const { supabase } = await requireFullStaffSupabase();
  const st = state.trim().toUpperCase();
  if (st.length !== 2) throw new Error("Use a two-letter state code.");
  const { error } = await supabase.rpc("admin_appoint_senate_seat", {
    p_user_id: userId,
    p_state: st,
    p_class: senateClass,
  });
  if (error) throw new Error(error.message);
  revalidateCongressAndDirectory();
}

export async function appointChamberLeadershipForProfile(userId: string, role: string): Promise<void> {
  const r = role.trim();
  if (!isLeadershipRole(r)) throw new Error("Invalid leadership role.");
  const { supabase } = await requireFullStaffSupabase();
  const { error } = await supabase.rpc("admin_appoint_chamber_leadership", {
    p_role: r,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  revalidateCongressAndDirectory();
}

export async function appointPresidentForProfile(userId: string): Promise<void> {
  const { supabase } = await requireFullStaffSupabase();
  const { error } = await supabase.rpc("admin_appoint_president", { p_user_id: userId });
  if (error) throw new Error(error.message);
  revalidateCongressAndDirectory();
}

export async function appointVicePresidentForProfile(userId: string): Promise<void> {
  const { supabase } = await requireFullStaffSupabase();
  const { error } = await supabase.rpc("admin_appoint_vice_president", { p_user_id: userId });
  if (error) throw new Error(error.message);
  revalidateCongressAndDirectory();
}
