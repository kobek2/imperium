import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { POLITICAL_ROLE_LABELS, CITY_ROLE_KEYS } from "@/config/political-roles";
import { getServerAuth } from "@/lib/supabase/server";
import { getPlaceholderForRole } from "@/lib/directory-placeholders";
import type { DirectoryHolder } from "@/lib/directory-types";
import {
  loadDepartmentHeadHolders,
  loadSeatedCouncilPoliticians,
  loadSimLeadershipHolders,
  mergeCouncilDirectory,
} from "@/lib/sim-politicians";
import { loadEnactedOrdinancesForDirectory } from "@/lib/city-office-data";
import {
  HierarchyTabs,
  type DirectoryTab,
  type LawEntry,
} from "./hierarchy-tabs";
import { DirectoryHashScroll } from "./directory-hash-scroll";

/** PostgREST returns at most 1000 rows per request unless paged. */
const POSTGREST_PAGE = 1000;

const DIRECTORY_PROFILE_COLUMNS =
  "id, character_name, discord_username, office_role, party, bio, face_claim_url, residence_state, home_district_code" as const;

type DirectoryProfileRow = {
  id: string;
  character_name: string | null;
  discord_username: string | null;
  office_role: string | null;
  party: string | null;
  bio: string | null;
  face_claim_url: string | null;
  residence_state: string | null;
  home_district_code: string | null;
};

async function loadDirectoryGrantsAndProfiles(supabase: SupabaseClient): Promise<{
  grants: Array<{ user_id: string; role_key: string }>;
  profiles: DirectoryProfileRow[];
}> {
  const grants: Array<{ user_id: string; role_key: string }> = [];
  let gFrom = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("government_role_grants")
      .select("user_id, role_key")
      .order("user_id", { ascending: true })
      .order("role_key", { ascending: true })
      .range(gFrom, gFrom + POSTGREST_PAGE - 1);
    if (error) {
      console.warn("[directory] government_role_grants:", error.message);
      break;
    }
    const chunk = (data ?? []) as Array<{ user_id: string; role_key: string }>;
    grants.push(...chunk);
    if (chunk.length < POSTGREST_PAGE) break;
    gFrom += POSTGREST_PAGE;
  }

  const profiles: DirectoryProfileRow[] = [];
  let pFrom = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("profiles")
      .select(DIRECTORY_PROFILE_COLUMNS)
      .order("id", { ascending: true })
      .range(pFrom, pFrom + POSTGREST_PAGE - 1);
    if (error) {
      console.warn("[directory] profiles:", error.message);
      break;
    }
    const chunk = (data ?? []) as DirectoryProfileRow[];
    profiles.push(...chunk);
    if (chunk.length < POSTGREST_PAGE) break;
    pFrom += POSTGREST_PAGE;
  }

  return { grants, profiles };
}

/** Always resolve grants + profiles from Supabase (no stale RSC snapshot of the roster). */
export const dynamic = "force-dynamic";

/**
 * NYC city government tabs. Sections render as featured big-cards (Mayor, Council Spokesperson)
 * or grid portrait cards (council districts, department heads).
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

const DEPT_ROLE_KEYS = CITY_ROLE_KEYS.filter((k) => k.startsWith("dept_"));

const TABS: DirectoryTabConfig[] = [
  {
    id: "city-hall",
    label: "City Hall",
    heroTitle: "City Hall",
    heroKicker: "Executive Branch",
    sections: [
      { kind: "featured", roleKeys: ["mayor"] },
      { kind: "enacted_laws", title: "Local laws enacted" },
    ],
  },
  {
    id: "city-council",
    label: "City Council",
    heroTitle: "New York City Council",
    heroKicker: "Legislative Branch",
    sections: [
      { kind: "featured", roleKeys: ["council_spokesperson"] },
      {
        kind: "grid",
        title: "Council members (W01–W07)",
        roleKeys: ["council_member"],
        maxSlots: 7,
      },
    ],
  },
  {
    id: "city-departments",
    label: "City Departments",
    heroTitle: "City Departments",
    heroKicker: "Agency Leadership",
    sections: [
      {
        kind: "grid",
        title: "Department heads",
        roleKeys: [...DEPT_ROLE_KEYS],
      },
    ],
  },
];

export default async function DirectoryPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to load hierarchy data.
      </div>
    );
  }

  if (!user) redirect("/login");

  const [{ grants, profiles }, { data: lawBills }, seatedCouncil, simLeadership, departmentHeads, enactedOrdinances] =
    await Promise.all([
      loadDirectoryGrantsAndProfiles(supabase),
      supabase
        .from("bills")
        .select("id, title, originating_chamber, created_at, signed_at, author_id")
        .eq("status", "law")
        .order("signed_at", { ascending: false, nullsFirst: false }),
      loadSeatedCouncilPoliticians(supabase),
      loadSimLeadershipHolders(supabase),
      loadDepartmentHeadHolders(supabase),
      loadEnactedOrdinancesForDirectory(supabase),
    ]);

  const lawBillRows = (lawBills ?? []) as Array<{
    id: string;
    title: string;
    originating_chamber: "house" | "senate";
    created_at: string;
    signed_at: string | null;
    author_id: string;
  }>;

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
    profiles.map((p) => [
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
  for (const g of grants) addHolder(g.role_key, g.user_id);
  for (const p of profiles) {
    if (p.office_role) addHolder(p.office_role, p.id);
  }
  for (const [roleKey, holder] of departmentHeads) {
    const bucket = holdersByRole.get(roleKey) ?? new Map<string, DirectoryHolder>();
    bucket.set(holder.id, holder);
    holdersByRole.set(roleKey, bucket);
  }

  const getRealHolders = (roleKey: string) =>
    [...(holdersByRole.get(roleKey)?.values() ?? [])].sort((a, b) =>
      (a.character_name ?? a.discord_username ?? "").localeCompare(
        b.character_name ?? b.discord_username ?? "",
      ),
    );

  function holdersForDirectory(roleKey: string, maxSlots?: number): DirectoryHolder[] {
    const real = getRealHolders(roleKey);
    if (roleKey === "council_member") {
      const merged = mergeCouncilDirectory(real, seatedCouncil);
      if (merged.length > 0) return merged;
      return real;
    }
    if (real.length > 0) return real;
    const simHolder = simLeadership.get(roleKey);
    if (simHolder) return [simHolder];
    const ph = getPlaceholderForRole(roleKey);
    return ph ? [ph] : [];
  }

  const laws: LawEntry[] = [
    ...lawBillRows.map((b) => {
      const tally = lawTallies.get(b.id);
      const author = profileById.get(b.author_id);
      return {
        id: b.id,
        title: b.title,
        source: "bill" as const,
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
    }),
    ...enactedOrdinances.map((o) => ({
      id: o.id,
      title: o.title,
      source: "ordinance" as const,
      signed_at: o.enactedAt,
      created_at: o.createdAt,
      category: o.categoryLabel,
      stance_label: o.stanceLabel,
      council_yea: o.councilYeas,
      council_nay: o.councilNays,
      sponsor_name: o.sponsorName,
    })),
  ].sort((a, b) => {
    const aTime = new Date(a.signed_at ?? a.created_at).getTime();
    const bTime = new Date(b.signed_at ?? b.created_at).getTime();
    return bTime - aTime;
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
      <HierarchyTabs tabs={tabs} />
    </div>
  );
}
