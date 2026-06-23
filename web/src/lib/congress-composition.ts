import type { SupabaseClient } from "@supabase/supabase-js";
import { POLITICAL_ROLE_LABELS } from "@/config/political-roles";
import type { BillChamber } from "@/lib/bill-types";
import {
  houseSeatKey,
  loadSeatedHousePoliticians,
  loadSeatedSenatePoliticians,
  loadSimLeadershipHolders,
  mergeSenateDirectory,
} from "@/lib/sim-politicians";

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
  "house_deputy",
  "house_majority_leader",
  "house_majority_whip",
  "house_minority_leader",
  "house_minority_whip",
] as const;

const SENATE_LEADER_KEYS = [
  "president_pro_tempore",
  "senate_deputy",
  "senate_majority_leader",
  "senate_majority_whip",
  "senate_minority_leader",
  "senate_minority_whip",
] as const;

const HOUSE_VOTING_ROLE_KEYS = new Set<string>([
  "representative",
  "speaker",
  "house_majority_leader",
  "house_majority_whip",
  "house_minority_leader",
  "house_minority_whip",
]);

const SENATE_VOTING_ROLE_KEYS = new Set<string>([
  "senator",
  "president_pro_tempore",
  "senate_majority_leader",
  "senate_majority_whip",
  "senate_minority_leader",
  "senate_minority_whip",
]);

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

export function mergeHouseDirectory<T extends { home_district_code: string | null }>(
  playerHolders: T[],
  rosterHolders: T[],
): T[] {
  const playerDistricts = new Set(
    playerHolders.map((h) => houseSeatKey(h)).filter(Boolean),
  );
  return [
    ...playerHolders,
    ...rosterHolders.filter((h) => !playerDistricts.has(houseSeatKey(h))),
  ];
}

function displayName(p: {
  character_name: string | null;
  discord_username: string | null;
}): string {
  const n = p.character_name?.trim() || p.discord_username?.trim();
  return n || "Vacant seat";
}

function compositionForParties(parties: Array<string | null>): ChamberComposition {
  const counts = emptyCounts();
  for (const party of parties) bumpParty(counts, party);
  return { counts, total: parties.length };
}

export async function fetchCongressOverviewSnapshot(
  supabase: SupabaseClient,
): Promise<CongressOverviewSnapshot | null> {
  const [{ data: grants }, { data: profiles }, seatedHouse, seatedSenate, simLeadership] =
    await Promise.all([
    supabase.from("government_role_grants").select("user_id, role_key"),
    supabase
      .from("profiles")
      .select("id, character_name, discord_username, office_role, party, home_district_code, residence_state"),
    loadSeatedHousePoliticians(supabase),
    loadSeatedSenatePoliticians(supabase),
    loadSimLeadershipHolders(supabase),
  ]);

  const gRows = (grants ?? []) as { user_id: string; role_key: string }[];
  const pRows = (profiles ?? []) as Array<{
    id: string;
    character_name: string | null;
    discord_username: string | null;
    office_role: string | null;
    party: string | null;
    home_district_code: string | null;
    residence_state: string | null;
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
  for (const [roleKey, holder] of simLeadership) {
    if (!holdersByRole.get(roleKey)?.size) {
      const bucket = holdersByRole.get(roleKey) ?? new Map<string, LeaderHolder>();
      bucket.set(holder.id, {
        id: holder.id,
        name: holder.character_name?.trim() || "Roster leader",
        party: holder.party,
      });
      holdersByRole.set(roleKey, bucket);
    }
  }

  const houseIds = collectChamberMemberIds(gRows, pRows, "representative");
  const senateIds = collectChamberMemberIds(gRows, pRows, "senator");

  const playerReps = [...houseIds]
    .map((id) => profileById.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ party: p.party, home_district_code: p.home_district_code }));

  const playerSens = [...senateIds]
    .map((id) => profileById.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ party: p.party, residence_state: p.residence_state }));

  const houseMembers = mergeHouseDirectory(playerReps, seatedHouse);
  const senateMembers = mergeSenateDirectory(playerSens, seatedSenate);

  const house = compositionForParties(houseMembers.map((m) => m.party));
  const senate = compositionForParties(senateMembers.map((m) => m.party));

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

/** Distinct members who may cast a chamber floor vote: seated reps/senators (grants + office_role) plus
 *  leadership roles in the same chamber (grants + office_role). Matches Congress overview composition for
 *  seats, and includes leaders who vote without a separate `representative` / `senator` office_role row. */
export async function countChamberVotingMembers(
  supabase: SupabaseClient,
  chamber: BillChamber,
): Promise<number> {
  const chamberRoles = chamber === "house" ? HOUSE_VOTING_ROLE_KEYS : SENATE_VOTING_ROLE_KEYS;
  const [{ data: grants }, { data: profiles }] = await Promise.all([
    supabase.from("government_role_grants").select("user_id, role_key"),
    supabase.from("profiles").select("id, office_role"),
  ]);
  const gRows = (grants ?? []) as { user_id: string; role_key: string }[];
  const pRows = (profiles ?? []) as { id: string; office_role: string | null }[];
  const memberRole = chamber === "house" ? "representative" : "senator";
  const ids = collectChamberMemberIds(gRows, pRows, memberRole);

  for (const p of pRows) {
    if (chamberRoles.has(String(p.office_role ?? ""))) ids.add(p.id);
  }
  for (const g of gRows) {
    if (chamberRoles.has(g.role_key)) ids.add(g.user_id);
  }

  if (ids.size > 0) return ids.size;

  const snap = await fetchCongressOverviewSnapshot(supabase);
  if (!snap) return 0;
  return chamber === "house" ? snap.house.total : snap.senate.total;
}

/** User ids with a chamber seat (representative / senator), for participation checks. */
export async function fetchChamberMemberUserIds(
  supabase: SupabaseClient,
  chamber: BillChamber,
): Promise<Set<string>> {
  const [{ data: grants }, { data: profiles }] = await Promise.all([
    supabase.from("government_role_grants").select("user_id, role_key"),
    supabase.from("profiles").select("id, office_role"),
  ]);
  const gRows = (grants ?? []) as { user_id: string; role_key: string }[];
  const pRows = (profiles ?? []) as { id: string; office_role: string | null }[];
  const memberRole = chamber === "house" ? "representative" : "senator";
  return collectChamberMemberIds(gRows, pRows, memberRole);
}
