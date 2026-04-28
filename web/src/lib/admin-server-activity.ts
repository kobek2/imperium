import { formatISO, startOfDay, subDays } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LedgerKindSlice = { kind: string; count: number; sumDelta: number };
export type LedgerDaySlice = { day: string; count: number; netDelta: number };

export type AdminServerActivitySnapshot = {
  generatedAt: string;
  profileCount: number | null;
  totalBills: number | null;
  billsByStatus: Record<string, number>;
  billsStatusSampleTruncated: boolean;
  electionsByPhase: Record<string, number>;
  electionCandidatesTotal: number | null;
  walletRows: number | null;
  walletBalanceSum: number;
  partyOrgs: Array<{
    party_key: string;
    treasury_balance: number;
    updated_at?: string | null;
    charter_ratified_at?: string | null;
  }>;
  officerCandidaciesTotal: number | null;
  pacByLevel: Record<number, number>;
  pacTotal: number | null;
  primaryVotes14d: number | null;
  generalVotes14d: number | null;
  endorsements14d: number | null;
  campaignAds30d: number | null;
  billVotes7d: number | null;
  fiscalYear: { id: string; label: string; status: string } | null;
  budgetStatus: string | null;
  nationalMetrics: {
    government_approval: number | null;
    unemployment_rate: number | null;
    us_debt: number | null;
    poverty_percentage: number | null;
    crime_total: number | null;
    updated_at?: string | null;
  } | null;
  ledgerDaily30: LedgerDaySlice[];
  ledgerKinds14: LedgerKindSlice[];
  ledgerSampleTruncated: boolean;
  recentLedger: Array<{
    id: string;
    wallet_user_id: string;
    delta: number;
    kind: string;
    created_at: string;
  }>;
  recentBills: Array<{ id: string; title: string; status: string; created_at: string }>;
  recentAds: Array<{
    id: string;
    election_id: string;
    points: number;
    target_state: string | null;
    created_at: string;
  }>;
};

function bucketLedger(
  rows: Array<{ created_at: string; kind: string; delta: number | string | null }>,
  days: number,
): { daily: LedgerDaySlice[]; kinds14: LedgerKindSlice[] } {
  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dayKeys.push(formatISO(startOfDay(subDays(new Date(), i)), { representation: "date" }));
  }
  const dailyMap = new Map<string, { count: number; netDelta: number }>();
  for (const d of dayKeys) dailyMap.set(d, { count: 0, netDelta: 0 });

  const kindMap = new Map<string, { count: number; sumDelta: number }>();
  const cutoff14 = startOfDay(subDays(new Date(), 14));

  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    const bucket = dailyMap.get(day);
    const delta = Number(r.delta ?? 0);
    if (bucket) {
      bucket.count += 1;
      bucket.netDelta += delta;
    }
    const created = new Date(r.created_at);
    if (!Number.isNaN(created.getTime()) && created >= cutoff14) {
      const k = r.kind || "unknown";
      const cur = kindMap.get(k) ?? { count: 0, sumDelta: 0 };
      cur.count += 1;
      cur.sumDelta += delta;
      kindMap.set(k, cur);
    }
  }

  const daily: LedgerDaySlice[] = dayKeys.map((day) => {
    const b = dailyMap.get(day)!;
    return { day, count: b.count, netDelta: b.netDelta };
  });

  const kinds14: LedgerKindSlice[] = [...kindMap.entries()]
    .map(([kind, v]) => ({ kind, count: v.count, sumDelta: v.sumDelta }))
    .sort((a, b) => b.count - a.count);

  return { daily, kinds14 };
}

/** Sample size for bill status histogram (must match UI copy). */
export const ADMIN_ACTIVITY_BILL_STATUS_SAMPLE = 12_000;
const LEDGER_SAMPLE = 15_000;

export async function loadAdminServerActivitySnapshot(
  supabase: SupabaseClient,
): Promise<AdminServerActivitySnapshot> {
  const now = new Date();
  const generatedAt = now.toISOString();
  const thirtyDaysAgo = formatISO(subDays(now, 30));
  const fourteenDaysAgo = formatISO(subDays(now, 14));
  const sevenDaysAgo = formatISO(subDays(now, 7));

  const { data: activeFy } = await supabase
    .from("rp_fiscal_years")
    .select("id, label, status")
    .eq("status", "active")
    .maybeSingle();

  const fyId = activeFy?.id as string | undefined;

  const [
    { count: profileCount },
    { count: totalBills },
    { data: billStatusRows },
    { data: electionPhaseRows },
    { count: electionCandidatesTotal },
    { data: wallets },
    { data: partyOrgs },
    { count: officerCandidaciesTotal },
    { data: pacRows },
    { count: primaryVotes14d },
    { count: generalVotes14d },
    { count: endorsements14d },
    { count: campaignAds30d },
    { count: billVotes7d },
    { data: fyBudget },
    { data: nationalRow },
    { data: ledgerRows },
    { data: recentLedger },
    { data: recentBills },
    { data: recentAds },
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("bills").select("id", { count: "exact", head: true }),
    supabase.from("bills").select("status").limit(ADMIN_ACTIVITY_BILL_STATUS_SAMPLE),
    supabase.from("elections").select("phase").limit(2000),
    supabase.from("election_candidates").select("id", { count: "exact", head: true }),
    supabase.from("economy_wallets").select("balance"),
    supabase
      .from("party_organizations")
      .select("party_key, treasury_balance, updated_at, charter_ratified_at")
      .order("party_key"),
    supabase.from("party_officer_candidacies").select("party_key", { count: "exact", head: true }),
    supabase.from("economy_pacs").select("level"),
    supabase
      .from("primary_votes")
      .select("id", { count: "exact", head: true })
      .gte("created_at", fourteenDaysAgo),
    supabase
      .from("general_votes")
      .select("id", { count: "exact", head: true })
      .gte("created_at", fourteenDaysAgo),
    supabase
      .from("campaign_endorsements")
      .select("election_id", { count: "exact", head: true })
      .gte("created_at", fourteenDaysAgo),
    supabase
      .from("campaign_ads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo),
    supabase
      .from("bill_votes")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo),
    fyId
      ? supabase.from("federal_budgets").select("status").eq("fiscal_year_id", fyId).maybeSingle()
      : Promise.resolve({ data: null as { status: string } | null }),
    fyId
      ? supabase
          .from("national_metrics")
          .select(
            "government_approval, unemployment_rate, us_debt, poverty_percentage, crime_total, updated_at",
          )
          .eq("fiscal_year_id", fyId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("economy_ledger")
      .select("created_at, kind, delta")
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(LEDGER_SAMPLE),
    supabase
      .from("economy_ledger")
      .select("id, wallet_user_id, delta, kind, created_at")
      .order("created_at", { ascending: false })
      .limit(40),
    supabase.from("bills").select("id, title, status, created_at").order("created_at", { ascending: false }).limit(12),
    supabase
      .from("campaign_ads")
      .select("id, election_id, points, target_state, created_at")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const billsByStatus: Record<string, number> = {};
  for (const row of billStatusRows ?? []) {
    const s = String((row as { status: string }).status);
    billsByStatus[s] = (billsByStatus[s] ?? 0) + 1;
  }
  const billsStatusSampleTruncated = (billStatusRows?.length ?? 0) >= ADMIN_ACTIVITY_BILL_STATUS_SAMPLE;

  const electionsByPhase: Record<string, number> = {};
  for (const row of electionPhaseRows ?? []) {
    const p = String((row as { phase: string }).phase);
    electionsByPhase[p] = (electionsByPhase[p] ?? 0) + 1;
  }

  let walletBalanceSum = 0;
  for (const w of wallets ?? []) {
    walletBalanceSum += Number((w as { balance?: number }).balance ?? 0);
  }

  const pacByLevel: Record<number, number> = {};
  for (const pr of pacRows ?? []) {
    const lvl = Number((pr as { level: number }).level);
    pacByLevel[lvl] = (pacByLevel[lvl] ?? 0) + 1;
  }

  const ledgerList = (ledgerRows ?? []) as Array<{ created_at: string; kind: string; delta: number | string | null }>;
  const ledgerSampleTruncated = ledgerList.length >= LEDGER_SAMPLE;
  const { daily: ledgerDaily30, kinds14: ledgerKinds14 } = bucketLedger(ledgerList, 30);

  const nm = nationalRow as AdminServerActivitySnapshot["nationalMetrics"] | null;

  return {
    generatedAt,
    profileCount: profileCount ?? null,
    totalBills: totalBills ?? null,
    billsByStatus,
    billsStatusSampleTruncated,
    electionsByPhase,
    electionCandidatesTotal: electionCandidatesTotal ?? null,
    walletRows: wallets?.length ?? null,
    walletBalanceSum,
    partyOrgs: (partyOrgs ?? []) as AdminServerActivitySnapshot["partyOrgs"],
    officerCandidaciesTotal: officerCandidaciesTotal ?? null,
    pacByLevel,
    pacTotal: pacRows?.length ?? null,
    primaryVotes14d: primaryVotes14d ?? null,
    generalVotes14d: generalVotes14d ?? null,
    endorsements14d: endorsements14d ?? null,
    campaignAds30d: campaignAds30d ?? null,
    billVotes7d: billVotes7d ?? null,
    fiscalYear: activeFy
      ? { id: String(activeFy.id), label: String(activeFy.label ?? ""), status: String(activeFy.status ?? "") }
      : null,
    budgetStatus: fyBudget ? String((fyBudget as { status: string }).status) : null,
    nationalMetrics: nm,
    ledgerDaily30,
    ledgerKinds14,
    ledgerSampleTruncated,
    recentLedger: (recentLedger ?? []) as AdminServerActivitySnapshot["recentLedger"],
    recentBills: (recentBills ?? []) as AdminServerActivitySnapshot["recentBills"],
    recentAds: (recentAds ?? []) as AdminServerActivitySnapshot["recentAds"],
  };
}
