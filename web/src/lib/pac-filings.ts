import type { SupabaseClient } from "@supabase/supabase-js";

type CandidateRef = {
  id: string;
  user_id: string | null;
  is_npc?: boolean | null;
  npc_name?: string | null;
};

export type ElectionPacFilingRow = {
  id: string;
  pacName: string;
  pacUserId: string;
  candidateId: string;
  candidateName: string;
  amount: number;
  campaignPoints: number;
  targetState: string | null;
  disclosedAt: string;
};

export type ElectionPacCandidateTotal = {
  candidateId: string;
  candidateName: string;
  totalAmount: number;
  totalPoints: number;
  committeeCount: number;
};

export type ElectionPacFilingsBundle = {
  filings: ElectionPacFilingRow[];
  totalDisclosed: number;
  committeeCount: number;
  byCandidate: ElectionPacCandidateTotal[];
};

function candidateLabel(
  candidateId: string,
  candidates: CandidateRef[],
  nameBy: Record<string, string>,
): string {
  const c = candidates.find((row) => row.id === candidateId);
  if (!c) return candidateId.slice(0, 8);
  if (c.is_npc && c.npc_name?.trim()) return `${c.npc_name.trim()} (NPC)`;
  if (!c.user_id) return "NPC";
  return nameBy[c.user_id]?.trim() || c.user_id.slice(0, 8);
}

export async function loadElectionPacFilings(
  supabase: SupabaseClient,
  electionId: string,
  candidates: CandidateRef[],
  nameBy: Record<string, string>,
): Promise<ElectionPacFilingsBundle> {
  const { data: rows } = await supabase
    .from("pac_contributions")
    .select("id, pac_user_id, candidate_id, amount, campaign_points, target_state, disclosed_at")
    .eq("election_id", electionId)
    .eq("is_dark", false)
    .order("disclosed_at", { ascending: false });

  const contributions = rows ?? [];
  if (contributions.length === 0) {
    return { filings: [], totalDisclosed: 0, committeeCount: 0, byCandidate: [] };
  }

  const pacUserIds = [...new Set(contributions.map((r) => (r as { pac_user_id: string }).pac_user_id))];
  const { data: pacs } = await supabase
    .from("economy_pacs")
    .select("user_id, pac_name")
    .in("user_id", pacUserIds);
  const pacNameByUser = new Map(
    (pacs ?? []).map((p) => [p.user_id as string, String(p.pac_name ?? "PAC")]),
  );

  const filings: ElectionPacFilingRow[] = contributions.map((raw) => {
    const row = raw as {
      id: string;
      pac_user_id: string;
      candidate_id: string;
      amount: number;
      campaign_points: number;
      target_state: string | null;
      disclosed_at: string;
    };
    return {
      id: row.id,
      pacName: pacNameByUser.get(row.pac_user_id) ?? "Unknown committee",
      pacUserId: row.pac_user_id,
      candidateId: row.candidate_id,
      candidateName: candidateLabel(row.candidate_id, candidates, nameBy),
      amount: Number(row.amount),
      campaignPoints: Number(row.campaign_points),
      targetState: row.target_state?.trim().toUpperCase() || null,
      disclosedAt: row.disclosed_at,
    };
  });

  const byCandidateMap = new Map<
    string,
    { totalAmount: number; totalPoints: number; committees: Set<string> }
  >();
  for (const f of filings) {
    let agg = byCandidateMap.get(f.candidateId);
    if (!agg) {
      agg = { totalAmount: 0, totalPoints: 0, committees: new Set() };
      byCandidateMap.set(f.candidateId, agg);
    }
    agg.totalAmount += f.amount;
    agg.totalPoints += f.campaignPoints;
    agg.committees.add(f.pacUserId);
  }

  const byCandidate: ElectionPacCandidateTotal[] = [...byCandidateMap.entries()]
    .map(([candidateId, agg]) => ({
      candidateId,
      candidateName: candidateLabel(candidateId, candidates, nameBy),
      totalAmount: agg.totalAmount,
      totalPoints: agg.totalPoints,
      committeeCount: agg.committees.size,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    filings,
    totalDisclosed: filings.reduce((s, f) => s + f.amount, 0),
    committeeCount: pacUserIds.length,
    byCandidate,
  };
}
