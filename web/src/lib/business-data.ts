import type { SupabaseClient } from "@supabase/supabase-js";
import type { PacContributionTarget } from "@/components/pac-dashboard";
import { PAC_LEGAL_CAP_PER_CANDIDATE } from "@/lib/economy-config";

type CandidateRow = {
  id: string;
  user_id: string | null;
  election_id: string;
  party: string;
  primary_winner?: boolean | null;
  is_npc?: boolean | null;
  npc_name?: string | null;
};

type ElectionRow = {
  id: string;
  office: string;
  state: string | null;
  district_code: string | null;
};

function electionSeatLabel(el: ElectionRow): string {
  if (el.office === "president") return "President";
  if (el.office === "house") return el.district_code ?? el.state ?? "House";
  return el.state ?? "Senate";
}

function candidateDisplayName(c: CandidateRow, nameById: Map<string, string>): string {
  if (c.is_npc && c.npc_name?.trim()) return `${c.npc_name.trim()} (NPC)`;
  if (!c.user_id) return "NPC";
  return nameById.get(c.user_id) ?? c.user_id.slice(0, 8);
}

function isGeneralNominee(electionId: string, candidate: CandidateRow, all: CandidateRow[]): boolean {
  const inRace = all.filter((c) => c.election_id === electionId);
  const hasPrimaryWinners = inRace.some((c) => c.primary_winner === true);
  if (!hasPrimaryWinners) return true;
  return candidate.primary_winner === true;
}

async function loadProfileNameMap(
  supabase: SupabaseClient,
  candidates: CandidateRow[],
): Promise<Map<string, string>> {
  const userIds = [
    ...new Set(candidates.map((c) => c.user_id).filter((id): id is string => id != null)),
  ];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, character_name, discord_username").in("id", userIds)
    : { data: [] };

  return new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      ((p.character_name as string | null)?.trim() ||
        (p.discord_username as string | null)?.trim() ||
        (p.id as string).slice(0, 8)) as string,
    ]),
  );
}

export async function loadPacContributionTargets(
  supabase: SupabaseClient,
  userId: string,
  options?: { party?: string | null },
): Promise<PacContributionTarget[]> {
  const partyFilter = options?.party?.trim().toLowerCase() || null;
  const nowIso = new Date().toISOString();
  const { data: elections } = await supabase
    .from("elections")
    .select("id, office, state, district_code")
    .eq("phase", "general")
    .is("leadership_role", null)
    .gt("general_closes_at", nowIso);

  const electionRows = (elections ?? []) as ElectionRow[];
  if (electionRows.length === 0) return [];

  const electionIds = electionRows.map((e) => e.id);
  const { data: candidates } = await supabase
    .from("election_candidates")
    .select("id, user_id, election_id, party, primary_winner, is_npc, npc_name")
    .in("election_id", electionIds);

  const candidateRows = (candidates ?? []) as CandidateRow[];
  const nameById = await loadProfileNameMap(supabase, candidateRows);

  const electionById = new Map(electionRows.map((e) => [e.id, e]));
  const out: PacContributionTarget[] = [];

  for (const c of candidateRows) {
    if (c.user_id === userId) continue;
    if (partyFilter && c.party !== partyFilter) continue;
    if (!isGeneralNominee(c.election_id, c, candidateRows)) continue;
    const el = electionById.get(c.election_id);
    if (!el) continue;
    const seat = electionSeatLabel(el);
    const displayName = candidateDisplayName(c, nameById);
    out.push({
      electionId: c.election_id,
      candidateId: c.id,
      label: `${displayName} (${c.party}) · ${seat}`,
      office: el.office,
    });
  }

  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export async function loadPacGeneralElectionOpen(
  supabase: SupabaseClient,
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { count } = await supabase
    .from("elections")
    .select("id", { count: "exact", head: true })
    .eq("phase", "general")
    .is("leadership_role", null)
    .gt("general_closes_at", nowIso);
  return (count ?? 0) > 0;
}

export type PacDisclosureRow = {
  id: string;
  amount: number;
  campaignPoints: number;
  disclosedAt: string;
  label: string;
  targetState: string | null;
};

export type PacCandidateFundingSummary = {
  electionId: string;
  candidateId: string;
  label: string;
  office: string;
  disclosedTotal: number;
  remaining: number;
  cap: number;
  byState: Array<{ state: string; amount: number; points: number }>;
};

export async function loadPacCandidateFundingSummaries(
  supabase: SupabaseClient,
  userId: string,
  targets: PacContributionTarget[],
): Promise<PacCandidateFundingSummary[]> {
  if (targets.length === 0) return [];

  const { data: rows } = await supabase
    .from("pac_contributions")
    .select("election_id, candidate_id, amount, campaign_points, target_state")
    .eq("pac_user_id", userId)
    .eq("is_dark", false);

  const cap = PAC_LEGAL_CAP_PER_CANDIDATE;
  const byKey = new Map<
    string,
    { total: number; byState: Map<string, { amount: number; points: number }> }
  >();

  for (const raw of rows ?? []) {
    const row = raw as {
      election_id: string;
      candidate_id: string;
      amount: number;
      campaign_points: number;
      target_state: string | null;
    };
    const key = `${row.election_id}__${row.candidate_id}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = { total: 0, byState: new Map() };
      byKey.set(key, agg);
    }
    const amt = Number(row.amount);
    agg.total += amt;
    const st = row.target_state?.trim().toUpperCase();
    if (st) {
      const prev = agg.byState.get(st) ?? { amount: 0, points: 0 };
      agg.byState.set(st, {
        amount: prev.amount + amt,
        points: prev.points + Number(row.campaign_points),
      });
    }
  }

  return targets.map((t) => {
    const key = `${t.electionId}__${t.candidateId}`;
    const agg = byKey.get(key);
    const disclosedTotal = agg?.total ?? 0;
    return {
      electionId: t.electionId,
      candidateId: t.candidateId,
      label: t.label,
      office: t.office,
      disclosedTotal,
      remaining: Math.max(0, cap - disclosedTotal),
      cap,
      byState: [...(agg?.byState.entries() ?? [])]
        .map(([state, v]) => ({ state, amount: v.amount, points: v.points }))
        .sort((a, b) => a.state.localeCompare(b.state)),
    };
  });
}

export async function loadMyPacDisclosures(
  supabase: SupabaseClient,
  userId: string,
): Promise<PacDisclosureRow[]> {
  const { data: rows } = await supabase
    .from("pac_contributions")
    .select("id, amount, campaign_points, disclosed_at, election_id, candidate_id, target_state")
    .eq("pac_user_id", userId)
    .eq("is_dark", false)
    .order("disclosed_at", { ascending: false })
    .limit(20);

  const contributions = rows ?? [];
  if (contributions.length === 0) return [];

  const electionIds = [...new Set(contributions.map((r) => (r as { election_id: string }).election_id))];
  const candidateIds = [...new Set(contributions.map((r) => (r as { candidate_id: string }).candidate_id))];

  const [{ data: elections }, { data: candidates }] = await Promise.all([
    supabase.from("elections").select("id, office, state, district_code").in("id", electionIds),
    supabase
      .from("election_candidates")
      .select("id, user_id, election_id, party, is_npc, npc_name")
      .in("id", candidateIds),
  ]);

  const electionById = new Map(((elections ?? []) as ElectionRow[]).map((e) => [e.id, e]));
  const candidateById = new Map(((candidates ?? []) as CandidateRow[]).map((c) => [c.id, c]));
  const nameById = await loadProfileNameMap(supabase, (candidates ?? []) as CandidateRow[]);

  return contributions.map((raw) => {
    const row = raw as {
      id: string;
      amount: number;
      campaign_points: number;
      disclosed_at: string;
      election_id: string;
      candidate_id: string;
      target_state: string | null;
    };
    const cand = candidateById.get(row.candidate_id);
    const el = electionById.get(row.election_id);
    const seat = el ? electionSeatLabel(el) : "Race";
    const displayName = cand ? candidateDisplayName(cand, nameById) : row.candidate_id.slice(0, 8);
    const party = cand?.party ?? "";
    const label = party ? `${displayName} (${party}) · ${seat}` : `${displayName} · ${seat}`;
    return {
      id: row.id,
      amount: Number(row.amount),
      campaignPoints: Number(row.campaign_points),
      disclosedAt: row.disclosed_at,
      label,
      targetState: row.target_state?.trim().toUpperCase() || null,
    };
  });
}

export type PacMarketRow = {
  pac_id: string;
  name: string;
  owner_user_id: string;
  tier: number;
  treasury_balance: number;
  share_price: number;
  valuation: number;
  float_shares_available: number;
  shares_outstanding: number;
  revenue_hourly: number;
  exposure_risk: number;
  investor_count: number;
};

export type PacInvestmentRow = {
  pac_id: string;
  pac_name: string;
  owner_user_id: string;
  shares: number;
  avg_cost: number;
  share_price: number;
  market_value: number;
  gain_loss: number;
};
