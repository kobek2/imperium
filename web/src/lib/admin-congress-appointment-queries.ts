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
