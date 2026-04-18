import { redirect } from "next/navigation";
import { POLITICAL_ROLE_LABELS } from "@/config/political-roles";
import { tryCreateClient } from "@/lib/supabase/server";
import { HierarchyTabs, type DirectoryTab, type DirectoryHolder } from "./hierarchy-tabs";

/**
 * Each tab is a branch/chamber of government. Sections inside a tab render either as a
 * "featured" big-card block (for principal roles like President, Speaker, Pres Pro Tempore,
 * Chief Justice) or as a "grid" of smaller portrait cards (for leadership and rank-and-file).
 *
 * Keep role_key lists in this file and the presentation in hierarchy-tabs.tsx.
 */
type DirectoryTabConfig = {
  id: string;
  label: string;
  heroTitle: string;
  heroKicker?: string;
  sections: DirectoryTabSection[];
};

type DirectoryTabSection =
  | { kind: "featured"; roleKeys: string[] }
  | { kind: "grid"; title: string; roleKeys: string[] };

const TABS: DirectoryTabConfig[] = [
  {
    id: "white-house",
    label: "White House",
    heroTitle: "White House",
    heroKicker: "Executive Branch",
    sections: [
      { kind: "featured", roleKeys: ["president", "vice_president"] },
      {
        kind: "grid",
        title: "Cabinet",
        roleKeys: [
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
    ],
  },
  {
    id: "house",
    label: "House",
    heroTitle: "House of Representatives",
    heroKicker: "Legislative Branch",
    sections: [
      { kind: "featured", roleKeys: ["speaker"] },
      {
        kind: "grid",
        title: "Leadership",
        roleKeys: [
          "house_majority_leader",
          "house_majority_whip",
          "house_minority_leader",
          "house_minority_whip",
        ],
      },
      { kind: "grid", title: "Members", roleKeys: ["representative"] },
    ],
  },
  {
    id: "senate",
    label: "Senate",
    heroTitle: "United States Senate",
    heroKicker: "Legislative Branch",
    sections: [
      { kind: "featured", roleKeys: ["president_pro_tempore"] },
      {
        kind: "grid",
        title: "Leadership",
        roleKeys: [
          "senate_majority_leader",
          "senate_majority_whip",
          "senate_minority_leader",
          "senate_minority_whip",
        ],
      },
      { kind: "grid", title: "Members", roleKeys: ["senator"] },
    ],
  },
  {
    id: "scotus",
    label: "SCOTUS",
    heroTitle: "Supreme Court",
    heroKicker: "Judicial Branch",
    sections: [
      { kind: "featured", roleKeys: ["chief_justice"] },
      { kind: "grid", title: "Associate Justices", roleKeys: ["associate_justice"] },
    ],
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
    supabase
      .from("profiles")
      .select(
        "id, character_name, discord_username, office_role, party, bio, face_claim_url, residence_state, home_district_code",
      ),
  ]);

  const profileById = new Map<string, DirectoryHolder>(
    (profiles ?? []).map((p) => [
      p.id,
      {
        id: p.id,
        character_name: p.character_name,
        discord_username: p.discord_username,
        party: p.party,
        bio: p.bio,
        face_claim_url: p.face_claim_url,
        residence_state: p.residence_state,
        home_district_code: p.home_district_code,
      },
    ]),
  );

  const holdersByRole = new Map<string, Map<string, DirectoryHolder>>();
  const addHolder = (roleKey: string, userId: string) => {
    const p = profileById.get(userId) ?? {
      id: userId,
      character_name: null,
      discord_username: null,
      party: null,
      bio: null,
      face_claim_url: null,
      residence_state: null,
      home_district_code: null,
    };
    const bucket = holdersByRole.get(roleKey) ?? new Map<string, DirectoryHolder>();
    bucket.set(userId, p);
    holdersByRole.set(roleKey, bucket);
  };
  for (const g of grants ?? []) addHolder(g.role_key, g.user_id);
  for (const p of profiles ?? []) {
    if (p.office_role) addHolder(p.office_role, p.id);
  }

  const getHolders = (roleKey: string) =>
    [...(holdersByRole.get(roleKey)?.values() ?? [])].sort((a, b) =>
      (a.character_name ?? a.discord_username ?? "").localeCompare(
        b.character_name ?? b.discord_username ?? "",
      ),
    );

  const tabs: DirectoryTab[] = TABS.map((tab) => ({
    id: tab.id,
    label: tab.label,
    heroTitle: tab.heroTitle,
    heroKicker: tab.heroKicker,
    sections: tab.sections.map((section) => {
      if (section.kind === "featured") {
        return {
          kind: "featured" as const,
          roles: section.roleKeys.map((k) => ({
            role_key: k,
            role_label: POLITICAL_ROLE_LABELS[k] ?? k,
            holders: getHolders(k),
          })),
        };
      }
      return {
        kind: "grid" as const,
        title: section.title,
        roles: section.roleKeys.map((k) => ({
          role_key: k,
          role_label: POLITICAL_ROLE_LABELS[k] ?? k,
          holders: getHolders(k),
        })),
      };
    }),
  }));

  return <HierarchyTabs tabs={tabs} />;
}
