import { redirect } from "next/navigation";
import { POLITICAL_ROLE_LABELS } from "@/config/political-roles";
import { tryCreateClient } from "@/lib/supabase/server";
import { HierarchyTabs } from "./hierarchy-tabs";

type GroupDef = {
  id: string;
  label: string;
  keys: string[];
};

const GROUPS: GroupDef[] = [
  {
    id: "congress-members",
    label: "Members of Congress",
    keys: ["senator", "representative", "speaker", "president_pro_tempore"],
  },
  {
    id: "house-senate-leadership",
    label: "House & Senate Leadership",
    keys: [
      "speaker",
      "house_majority_leader",
      "house_majority_whip",
      "house_minority_leader",
      "house_minority_whip",
      "president_pro_tempore",
      "senate_majority_leader",
      "senate_majority_whip",
      "senate_minority_leader",
      "senate_minority_whip",
    ],
  },
  {
    id: "white-house",
    label: "White House",
    keys: [
      "president",
      "vice_president",
      "chief_of_staff",
      "secretary_of_state",
      "secretary_of_treasury",
      "attorney_general",
      "secretary_of_defense",
      "secretary_of_homeland_security",
      "secretary_of_health_and_human_services",
      "secretary_of_transportation",
      "secretary_of_energy",
      "secretary_of_interior",
      "secretary_of_agriculture",
      "secretary_of_commerce",
      "secretary_of_education",
      "secretary_of_veterans_affairs",
      "secretary_of_housing_and_urban_development",
    ],
  },
  {
    id: "scotus",
    label: "SCOTUS",
    keys: ["chief_justice", "associate_justice"],
  },
];

export default async function DirectoryPage() {
  const supabase = await tryCreateClient();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to load hierarchy data.
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: grants }, { data: profiles }] = await Promise.all([
    supabase.from("government_role_grants").select("user_id, role_key"),
    supabase.from("profiles").select("id, character_name, discord_username, office_role"),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const holdersByRole = new Map<string, Set<string>>();
  for (const g of grants ?? []) {
    const p = profileById.get(g.user_id);
    const name = p?.character_name || p?.discord_username || g.user_id.slice(0, 8);
    const set = holdersByRole.get(g.role_key) ?? new Set<string>();
    set.add(name);
    holdersByRole.set(g.role_key, set);
  }

  // Include legacy single office_role assignments if present.
  for (const p of profiles ?? []) {
    if (!p.office_role) continue;
    const name = p.character_name || p.discord_username || p.id.slice(0, 8);
    const set = holdersByRole.get(p.office_role) ?? new Set<string>();
    set.add(name);
    holdersByRole.set(p.office_role, set);
  }

  const groups = GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    rows: group.keys.map((key) => ({
      role_key: key,
      role_label: POLITICAL_ROLE_LABELS[key] ?? key,
      holders: [...(holdersByRole.get(key) ?? new Set<string>())].sort((a, b) => a.localeCompare(b)),
    })),
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Federal hierarchy</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--psc-muted)]">
          See who currently holds congressional, leadership, White House, and SCOTUS roles.
        </p>
      </header>
      <HierarchyTabs groups={groups} />
    </div>
  );
}