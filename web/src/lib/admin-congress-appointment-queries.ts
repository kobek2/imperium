import type { SupabaseClient } from "@supabase/supabase-js";

export type ChamberMemberOption = {
  id: string;
  character_name: string;
  discord_username: string | null;
  residence_state: string | null;
  home_district_code: string | null;
};

/** Representatives (grant or legacy office_role) for leadership appointment UI. */
export async function loadChamberSeatHolders(
  supabase: SupabaseClient,
  chamber: "house" | "senate",
): Promise<ChamberMemberOption[]> {
  const roleKey = chamber === "house" ? "representative" : "senator";
  const { data: grantRows, error: gErr } = await supabase
    .from("government_role_grants")
    .select("user_id")
    .eq("role_key", roleKey);
  if (gErr) return [];
  const ids = new Set<string>((grantRows ?? []).map((r) => String((r as { user_id: string }).user_id)));

  const { data: officeRows, error: oErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("office_role", roleKey);
  if (!oErr) {
    for (const r of officeRows ?? []) ids.add(String((r as { id: string }).id));
  }

  const idList = [...ids];
  if (!idList.length) return [];

  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("id, character_name, discord_username, residence_state, home_district_code")
    .in("id", idList)
    .order("character_name", { ascending: true })
    .limit(500);
  if (pErr) return [];

  return (profiles ?? []) as ChamberMemberOption[];
}

export type ExecutiveOfficerOption = ChamberMemberOption;

/** Current president / vice president from grants and legacy office_role. */
export async function loadExecutiveOfficers(
  supabase: SupabaseClient,
): Promise<{ president: ExecutiveOfficerOption | null; vicePresident: ExecutiveOfficerOption | null }> {
  async function holderForRole(roleKey: "president" | "vice_president"): Promise<ExecutiveOfficerOption | null> {
    const { data: grantRows } = await supabase
      .from("government_role_grants")
      .select("user_id")
      .eq("role_key", roleKey)
      .limit(1);
    let uid = grantRows?.[0] ? String((grantRows[0] as { user_id: string }).user_id) : null;
    if (!uid) {
      const { data: officeRow } = await supabase
        .from("profiles")
        .select("id")
        .eq("office_role", roleKey)
        .limit(1)
        .maybeSingle();
      uid = officeRow?.id ? String(officeRow.id) : null;
    }
    if (!uid) return null;
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, character_name, discord_username, residence_state, home_district_code")
      .eq("id", uid)
      .maybeSingle();
    return profile ? (profile as ExecutiveOfficerOption) : null;
  }

  const [president, vicePresident] = await Promise.all([
    holderForRole("president"),
    holderForRole("vice_president"),
  ]);
  return { president, vicePresident };
}
