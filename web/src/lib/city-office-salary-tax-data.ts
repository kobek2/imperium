import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultOfficeSalaryTaxBase,
  type CityOfficeSalaryTaxBase,
  type OfficeSalaryHolder,
} from "@/lib/city-office-salary-tax";

export async function loadCityOfficeSalaryTaxBase(
  supabase: SupabaseClient,
): Promise<CityOfficeSalaryTaxBase> {
  const { data: grants, error } = await supabase
    .from("government_role_grants")
    .select("user_id, role_key")
    .in("role_key", ["mayor", "council_member"]);

  if (error) {
    console.warn("[city-office-salary-tax] grants:", error.message);
    return defaultOfficeSalaryTaxBase([]);
  }

  const userIds = [...new Set((grants ?? []).map((g) => g.user_id))];
  const { data: profiles } = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, character_name, discord_username")
        .in("id", userIds)
    : { data: [] as { id: string; character_name: string | null; discord_username: string | null }[] };

  const nameById = new Map(
    (profiles ?? []).map((p) => [
      p.id,
      p.character_name?.trim() || p.discord_username?.trim() || "Unknown",
    ]),
  );

  const holders: OfficeSalaryHolder[] = (grants ?? []).map((g) => ({
    userId: g.user_id,
    name: nameById.get(g.user_id) ?? "Unknown",
    roleKey: g.role_key as "mayor" | "council_member",
  }));

  return defaultOfficeSalaryTaxBase(holders);
}
