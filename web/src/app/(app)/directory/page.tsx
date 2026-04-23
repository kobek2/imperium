import { redirect } from "next/navigation";
import { POLITICAL_ROLE_LABELS } from "@/config/political-roles";
import { CABINET_APPOINTMENT_ROLE_KEYS } from "@/config/cabinet-appointment-roles";
import { tryCreateClient } from "@/lib/supabase/server";
import { getPlaceholderForRole, mergeAssociateJusticeHolders } from "@/lib/directory-placeholders";
import type { DirectoryHolder } from "@/lib/directory-types";
import { getIsAdmin } from "@/lib/is-admin";
import { isPresident } from "@/lib/president";
import {
  HierarchyTabs,
  type DirectoryTab,
  type LawEntry,
} from "./hierarchy-tabs";
import { DirectoryHashScroll } from "./directory-hash-scroll";
import { DirectoryMetricsEntry } from "./directory-metrics-entry";

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
  | { kind: "grid"; title: string; roleKeys: string[]; maxSlots?: number }
  | { kind: "enacted_laws"; title: string };

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
        roleKeys: [...CABINET_APPOINTMENT_ROLE_KEYS],
      },
      { kind: "enacted_laws", title: "Bills signed into law" },
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
      {
        kind: "grid",
        title: "Associate Justices",
        roleKeys: ["associate_justice"],
        maxSlots: 8,
      },
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

  const [{ data: grants }, { data: profiles }, { data: lawBills }, pres, isAdmin] = await Promise.all([
    supabase.from("government_role_grants").select("user_id, role_key"),
    supabase
      .from("profiles")
      .select(
        "id, character_name, discord_username, office_role, party, bio, face_claim_url, residence_state, home_district_code",
      ),
    supabase
      .from("bills")
      .select("id, title, originating_chamber, created_at, signed_at, author_id")
      .eq("status", "law")
      .order("signed_at", { ascending: false, nullsFirst: false }),
    isPresident(supabase, user.id),
    getIsAdmin(),
  ]);

  const lawBillRows = (lawBills ?? []) as Array<{
    id: string;
    title: string;
    originating_chamber: "house" | "senate";
    created_at: string;
    signed_at: string | null;
    author_id: string;
  }>;

  // Only go fetch vote tallies if there are actually enacted laws to annotate.
  const lawTallies = new Map<
    string,
    { house_yea: number; house_nay: number; senate_yea: number; senate_nay: number }
  >();
  if (lawBillRows.length) {
    const { data: lawVotes } = await supabase
      .from("bill_votes")
      .select("bill_id, chamber, vote")
      .in(
        "bill_id",
        lawBillRows.map((b) => b.id),
      )
      .in("vote", ["yea", "nay"]);
    for (const v of (lawVotes ?? []) as Array<{
      bill_id: string;
      chamber: "house" | "senate";
      vote: "yea" | "nay";
    }>) {
      const t = lawTallies.get(v.bill_id) ?? {
        house_yea: 0,
        house_nay: 0,
        senate_yea: 0,
        senate_nay: 0,
      };
      if (v.chamber === "house" && v.vote === "yea") t.house_yea++;
      else if (v.chamber === "house" && v.vote === "nay") t.house_nay++;
      else if (v.chamber === "senate" && v.vote === "yea") t.senate_yea++;
      else if (v.chamber === "senate" && v.vote === "nay") t.senate_nay++;
      lawTallies.set(v.bill_id, t);
    }
  }

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

  const getRealHolders = (roleKey: string) =>
    [...(holdersByRole.get(roleKey)?.values() ?? [])].sort((a, b) =>
      (a.character_name ?? a.discord_username ?? "").localeCompare(
        b.character_name ?? b.discord_username ?? "",
      ),
    );

  function holdersForDirectory(roleKey: string, maxSlots?: number): DirectoryHolder[] {
    const real = getRealHolders(roleKey);
    if (roleKey === "associate_justice" && maxSlots != null && maxSlots > 0) {
      return mergeAssociateJusticeHolders(real, maxSlots);
    }
    if (real.length > 0) return real;
    const ph = getPlaceholderForRole(roleKey);
    return ph ? [ph] : [];
  }

  const laws: LawEntry[] = lawBillRows.map((b) => {
    const tally = lawTallies.get(b.id);
    const author = profileById.get(b.author_id);
    return {
      id: b.id,
      title: b.title,
      originating_chamber: b.originating_chamber,
      signed_at: b.signed_at,
      created_at: b.created_at,
      author_id: b.author_id,
      author_name:
        author?.character_name?.trim() || author?.discord_username?.trim() || null,
      author_party: author?.party ?? null,
      house_yea: tally?.house_yea ?? 0,
      house_nay: tally?.house_nay ?? 0,
      senate_yea: tally?.senate_yea ?? 0,
      senate_nay: tally?.senate_nay ?? 0,
    };
  });

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
            holders: holdersForDirectory(k),
          })),
        };
      }
      if (section.kind === "enacted_laws") {
        return {
          kind: "enacted_laws" as const,
          title: section.title,
          laws,
        };
      }
      return {
        kind: "grid" as const,
        title: section.title,
        maxSlots: section.maxSlots,
        roles: section.roleKeys.map((k) => ({
          role_key: k,
          role_label: POLITICAL_ROLE_LABELS[k] ?? k,
          holders: holdersForDirectory(k, section.maxSlots),
        })),
      };
    }),
  }));

  return (
    <div className="space-y-10">
      <DirectoryHashScroll />
      <DirectoryMetricsEntry showFederalBudget={pres || isAdmin} />
      <HierarchyTabs tabs={tabs} />
    </div>
  );
}
