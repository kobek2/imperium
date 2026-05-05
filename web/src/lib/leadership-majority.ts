import type { SupabaseClient } from "@supabase/supabase-js";
import { chamberRoleKey, type Chamber, type PartyKey } from "@/lib/leadership";

const MAJORITY_PARTIES: PartyKey[] = ["democrat", "republican", "independent"];

function assertParty(value: string | null): PartyKey | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v === "democrat" || v === "republican" || v === "independent") return v;
  return null;
}

async function inferControllingExecutiveParty(supabase: SupabaseClient): Promise<PartyKey | null> {
  const { data: grant } = await supabase
    .from("government_role_grants")
    .select("user_id")
    .eq("role_key", "president")
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!grant?.user_id) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("party")
    .eq("id", grant.user_id)
    .maybeSingle();
  return assertParty(profile?.party ?? null);
}

function pickPartyBySeniorityMultiset(
  leaders: PartyKey[],
  seniorityByParty: Record<PartyKey, number[]>,
): PartyKey | null {
  const lists = Object.fromEntries(
    leaders.map((p) => [p, [...seniorityByParty[p]].sort((a, b) => a - b)]),
  ) as Record<PartyKey, number[]>;

  let survivors = [...leaders];
  while (survivors.length > 1) {
    const heads = survivors
      .map((p) => lists[p][0])
      .filter((t): t is number => t !== undefined);
    if (!heads.length) return null;
    const minHead = Math.min(...heads);
    const withMin = survivors.filter((p) => lists[p][0] === minHead);
    if (withMin.length === survivors.length) {
      for (const p of survivors) lists[p].shift();
      if (survivors.every((p) => lists[p].length === 0)) return null;
      continue;
    }
    survivors = withMin;
  }
  return survivors[0] ?? null;
}

/**
 * Majority caucus for a chamber (seat grants + known party). Used when opening
 * `leadership_sessions` (admin or calendar).
 */
export async function inferMajorityParty(supabase: SupabaseClient, chamber: Chamber): Promise<PartyKey> {
  const key = chamberRoleKey(chamber);
  const { data: grants } = await supabase
    .from("government_role_grants")
    .select("user_id, granted_at")
    .eq("role_key", key);

  const firstGrantMs = new Map<string, number>();
  for (const g of grants ?? []) {
    const t = new Date((g as { granted_at?: string }).granted_at ?? 0).getTime();
    const cur = firstGrantMs.get(g.user_id);
    if (cur === undefined || t < cur) firstGrantMs.set(g.user_id, t);
  }

  const ids = [...firstGrantMs.keys()];
  if (!ids.length) return "democrat";

  const { data: profiles } = await supabase.from("profiles").select("id, party").in("id", ids);

  const counts: Record<PartyKey, number> = { democrat: 0, republican: 0, independent: 0 };
  const seniorityByParty: Record<PartyKey, number[]> = {
    democrat: [],
    republican: [],
    independent: [],
  };

  for (const p of profiles ?? []) {
    const party = assertParty(p.party);
    if (!party) continue;
    const grantedMs = firstGrantMs.get(p.id);
    if (grantedMs === undefined) continue;
    counts[party]++;
    seniorityByParty[party].push(grantedMs);
  }

  const max = Math.max(counts.democrat, counts.republican, counts.independent);
  if (max <= 0) return "democrat";

  const leaders = MAJORITY_PARTIES.filter((pk) => counts[pk] === max);
  if (leaders.length === 1) return leaders[0]!;

  const seniorityPick = pickPartyBySeniorityMultiset(leaders, seniorityByParty);
  if (seniorityPick) return seniorityPick;

  const whiteHouse = await inferControllingExecutiveParty(supabase);
  if (whiteHouse && leaders.includes(whiteHouse)) return whiteHouse;

  return [...leaders].sort()[0]!;
}
