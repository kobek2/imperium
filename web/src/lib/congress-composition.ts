import type { SupabaseClient } from "@supabase/supabase-js";
import { POLITICAL_ROLE_LABELS } from "@/config/political-roles";

export type PartyCounts = {
  democrat: number;
  republican: number;
  independent: number;
  /** Unaffiliated or unknown party */
  other: number;
};

export type ChamberComposition = {
  counts: PartyCounts;
  total: number;
};

export type LeaderHolder = { id: string; name: string; party: string | null };

export type LeaderSlot = {
  roleKey: string;
  label: string;
  holders: LeaderHolder[];
};

export type CongressOverviewSnapshot = {
  house: ChamberComposition;
  senate: ChamberComposition;
  houseLeaders: LeaderSlot[];
  senateLeaders: LeaderSlot[];
};

const HOUSE_LEADER_KEYS = [
  "speaker",
  "house_majority_leader",
  "house_majority_whip",
  "house_minority_leader",
  "house_minority_whip",
] as const;

const SENATE_LEADER_KEYS = [
  "president_pro_tempore",
  "senate_majority_leader",
  "senate_majority_whip",
  "senate_minority_leader",
  "senate_minority_whip",
] as const;

function emptyCounts(): PartyCounts {
  return { democrat: 0, republican: 0, independent: 0, other: 0 };
}

function bumpParty(counts: PartyCounts, party: string | null) {
  if (party === "democrat") counts.democrat += 1;
  else if (party === "republican") counts.republican += 1;
  else if (party === "independent") counts.independent += 1;
  else counts.other += 1;
}

function collectChamberMemberIds(
  grants: { user_id: string; role_key: string }[],
  profiles: { id: string; office_role: string | null }[],
  memberRole: "representative" | "senator",
): Set<string> {
  const ids = new Set<string>();
  for (const g of grants) {
    if (g.role_key === memberRole) ids.add(g.user_id);
  }
  for (const p of profiles) {
    if (p.office_role === memberRole) ids.add(p.id);
  }
  return ids;
}

function compositionForMemberIds(
  ids: Set<string>,
  profileById: Map<string, { party: string | null }>,
): ChamberComposition {
  const counts = emptyCounts();
  for (const id of ids) {
    bumpParty(counts, profileById.get(id)?.party ?? null);
  }
  return { counts, total: ids.size };
}

function displayName(p: {
  character_name: string | null;
  discord_username: string | null;
}): string {
  const n = p.character_name?.trim() || p.discord_username?.trim();
  return n || "Vacant seat";
}

export async function fetchCongressOverviewSnapshot(
  supabase: SupabaseClient,
): Promise<CongressOverviewSnapshot | null> {
  const [{ data: grants }, { data: profiles }] = await Promise.all([
    supabase.from("government_role_grants").select("user_id, role_key"),
    supabase
      .from("profiles")
      .select("id, character_name, discord_username, office_role, party"),
  ]);

  const gRows = (grants ?? []) as { user_id: string; role_key: string }[];
  const pRows = (profiles ?? []) as Array<{
    id: string;
    character_name: string | null;
    discord_username: string | null;
    office_role: string | null;
    party: string | null;
  }>;

  const profileById = new Map(pRows.map((p) => [p.id, p]));

  const holdersByRole = new Map<string, Map<string, LeaderHolder>>();
  const addHolder = (roleKey: string, userId: string) => {
    const p = profileById.get(userId);
    const holder: LeaderHolder = {
      id: userId,
      name: p ? displayName(p) : "Unknown member",
      party: p?.party ?? null,
    };
    const bucket = holdersByRole.get(roleKey) ?? new Map<string, LeaderHolder>();
    bucket.set(userId, holder);
    holdersByRole.set(roleKey, bucket);
  };

  for (const g of gRows) addHolder(g.role_key, g.user_id);
  for (const p of pRows) {
    if (p.office_role) addHolder(p.office_role, p.id);
  }

  const houseIds = collectChamberMemberIds(gRows, pRows, "representative");
  const senateIds = collectChamberMemberIds(gRows, pRows, "senator");

  const partyLookup = new Map<string, { party: string | null }>();
  for (const p of pRows) partyLookup.set(p.id, { party: p.party });

  const house = compositionForMemberIds(houseIds, partyLookup);
  const senate = compositionForMemberIds(senateIds, partyLookup);

  const slot = (keys: readonly string[]): LeaderSlot[] =>
    keys.map((roleKey) => ({
      roleKey,
      label: POLITICAL_ROLE_LABELS[roleKey] ?? roleKey,
      holders: [...(holdersByRole.get(roleKey)?.values() ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    }));

  return {
    house,
    senate,
    houseLeaders: slot(HOUSE_LEADER_KEYS),
    senateLeaders: slot(SENATE_LEADER_KEYS),
  };
}
