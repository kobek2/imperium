import type { SupabaseClient } from "@supabase/supabase-js";
import type { PacContributionTarget } from "@/components/pac-dashboard";
import { getCampaignDayCycle, type CampaignDayCycle } from "@/lib/campaign-day-cycle";
import {
  loadPacCandidateFundingSummaries,
  loadPacContributionTargets,
  loadPacGeneralElectionOpen,
  type PacCandidateFundingSummary,
} from "@/lib/business-data";
import type { LegislativeRoundBundle } from "@/lib/legislative-round-data";
import { loadLegislativeRoundBundle } from "@/lib/legislative-round-data";

export type CampaignManagerStatus = {
  active: boolean;
  humanParty: string;
  humanStrategistUserId: string | null;
  isHumanStrategist: boolean;
  rivalEnabled: boolean;
  rivalParty: string;
  rivalTreasury: number;
  rivalLabel: string;
  rivalDifficulty: string;
  starterGrant: number;
  myPacTreasury: number;
  myPacName: string | null;
  cstPhase: "elections" | "congress";
  electionWindow: boolean;
  congressWindow: boolean;
};

export type CampaignChamberScore = {
  houseDem: number;
  houseRep: number;
  houseTotal: number;
  senateDem: number;
  senateRep: number;
  senateTotal: number;
};

export type CampaignRaceRow = {
  electionId: string;
  office: string;
  seatLabel: string;
  phase: string;
  ourCandidateId: string | null;
  ourCandidateName: string;
  rivalCandidateId: string | null;
  rivalCandidateName: string;
  ourPacSpend: number;
  rivalPacSpend: number;
  generalClosesAt: string | null;
};

export type RivalPacFilingRow = {
  id: string;
  electionId: string;
  seatLabel: string;
  candidateName: string;
  amount: number;
  campaignPoints: number;
  targetState: string | null;
  disclosedAt: string;
  contributorLabel: string;
};

export type RivalIntelRow = {
  id: string;
  kind: string;
  summary: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type StrategistBillRow = {
  id: string;
  title: string;
  chamber: string;
  status: string;
  sponsorLabel: string | null;
  party: string | null;
  isRival: boolean;
  createdAt: string;
};

export type CampaignWarRoomData = {
  status: CampaignManagerStatus;
  dayCycle: CampaignDayCycle;
  chamber: CampaignChamberScore;
  races: CampaignRaceRow[];
  recentRivalFilings: RivalPacFilingRow[];
  rivalIntel: RivalIntelRow[];
  strategistBills: StrategistBillRow[];
  presidentElectionId: string | null;
  pacTargets: PacContributionTarget[];
  pacFundingSummaries: PacCandidateFundingSummary[];
  pacStates: Array<{ code: string; name: string }>;
  generalElectionOpen: boolean;
  economyFrozen: boolean;
  hasPac: boolean;
  legislativeRound: LegislativeRoundBundle;
};

function parseStatus(raw: unknown): CampaignManagerStatus {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    active: Boolean(row.active),
    humanParty: String(row.human_party ?? "democrat"),
    humanStrategistUserId: (row.human_strategist_user_id as string | null) ?? null,
    isHumanStrategist: Boolean(row.is_human_strategist),
    rivalEnabled: Boolean(row.rival_enabled),
    rivalParty: String(row.rival_party ?? "republican"),
    rivalTreasury: Number(row.rival_treasury ?? 0),
    rivalLabel: String(row.rival_label ?? "Rival War Room"),
    rivalDifficulty: String(row.rival_difficulty ?? "normal"),
    starterGrant: Number(row.starter_grant ?? 0),
    myPacTreasury: Number(row.my_pac_treasury ?? 0),
    myPacName: (row.my_pac_name as string | null) ?? null,
    cstPhase: (row.cst_phase === "congress" ? "congress" : "elections") as "elections" | "congress",
    electionWindow: Boolean(row.election_window),
    congressWindow: Boolean(row.congress_window),
  };
}

function seatLabel(office: string, districtCode: string | null, state: string | null): string {
  if (office === "president") return "President";
  if (office === "house") return districtCode ?? state ?? "House";
  return state ? `${state} Senate` : "Senate";
}

function candidateName(
  c: { is_npc?: boolean | null; npc_name?: string | null; user_id?: string | null },
  nameBy: Map<string, string>,
): string {
  if (c.is_npc && c.npc_name?.trim()) return `${c.npc_name.trim()} (NPC)`;
  if (!c.user_id) return "NPC";
  return nameBy.get(c.user_id) ?? c.user_id.slice(0, 8);
}

function isNominee(
  electionId: string,
  candidate: { primary_winner?: boolean | null },
  all: Array<{ election_id: string; primary_winner?: boolean | null }>,
): boolean {
  const inRace = all.filter((c) => c.election_id === electionId);
  const hasWinners = inRace.some((c) => c.primary_winner === true);
  if (!hasWinners) return true;
  return candidate.primary_winner === true;
}

export async function loadCampaignManagerStatus(
  supabase: SupabaseClient,
): Promise<CampaignManagerStatus> {
  const { data } = await supabase.rpc("campaign_manager_status");
  return parseStatus(data);
}

export async function loadCampaignWarRoom(
  supabase: SupabaseClient,
  userId: string,
): Promise<CampaignWarRoomData> {
  const status = await loadCampaignManagerStatus(supabase);
  const humanParty = status.humanParty;
  const rivalParty = status.rivalParty;

  const [{ data: districts }, { data: senateSeats }] = await Promise.all([
    supabase.from("districts").select("incumbent_party"),
    supabase.from("senate_seats").select("incumbent_party"),
  ]);

  const houseDem = (districts ?? []).filter((d) => String(d.incumbent_party).toUpperCase() === "D").length;
  const houseRep = (districts ?? []).filter((d) => String(d.incumbent_party).toUpperCase() === "R").length;
  const senateDem = (senateSeats ?? []).filter((s) => String(s.incumbent_party).toUpperCase() === "D").length;
  const senateRep = (senateSeats ?? []).filter((s) => String(s.incumbent_party).toUpperCase() === "R").length;

  const chamber: CampaignChamberScore = {
    houseDem,
    houseRep,
    houseTotal: houseDem + houseRep,
    senateDem,
    senateRep,
    senateTotal: senateDem + senateRep,
  };

  const { data: elections } = await supabase
    .from("elections")
    .select("id, office, state, district_code, phase, general_closes_at")
    .is("leadership_role", null)
    .in("office", ["president", "house", "senate"])
    .neq("phase", "closed")
    .not("filing_window_started_at", "is", null)
    .order("office")
    .order("district_code")
    .order("state");

  const electionRows = elections ?? [];
  const electionIds = electionRows.map((e) => e.id as string);

  const { data: candidates } = electionIds.length
    ? await supabase
        .from("election_candidates")
        .select("id, election_id, party, user_id, is_npc, npc_name, primary_winner")
        .in("election_id", electionIds)
    : { data: [] };

  const candRows = (candidates ?? []) as Array<{
    id: string;
    election_id: string;
    party: string;
    user_id: string | null;
    is_npc: boolean | null;
    npc_name: string | null;
    primary_winner: boolean | null;
  }>;

  const userIds = [...new Set(candRows.map((c) => c.user_id).filter((id): id is string => id != null))];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, character_name, discord_username").in("id", userIds)
    : { data: [] };
  const nameBy = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      String(p.character_name ?? p.discord_username ?? p.id).trim(),
    ]),
  );

  const { data: pacRows } = electionIds.length
    ? await supabase
        .from("pac_contributions")
        .select("election_id, candidate_id, amount, funded_by_rival, pac_user_id")
        .in("election_id", electionIds)
        .eq("is_dark", false)
    : { data: [] };

  const spendByCandidate = new Map<string, { ours: number; rival: number }>();
  for (const raw of pacRows ?? []) {
    const row = raw as {
      election_id: string;
      candidate_id: string;
      amount: number;
      funded_by_rival: boolean;
      pac_user_id: string | null;
    };
    const key = `${row.election_id}__${row.candidate_id}`;
    let agg = spendByCandidate.get(key);
    if (!agg) {
      agg = { ours: 0, rival: 0 };
      spendByCandidate.set(key, agg);
    }
    if (row.funded_by_rival) {
      agg.rival += Number(row.amount);
    } else if (row.pac_user_id === userId) {
      agg.ours += Number(row.amount);
    }
  }

  const races: CampaignRaceRow[] = [];
  let presidentElectionId: string | null = null;

  for (const el of electionRows) {
    const eid = el.id as string;
    const office = String(el.office);
    if (office === "president") presidentElectionId = eid;

    const inRace = candRows.filter((c) => c.election_id === eid && isNominee(eid, c, candRows));
    const ours = inRace.find((c) => c.party === humanParty);
    const rival = inRace.find((c) => c.party === rivalParty);
    const ourSpend = ours ? spendByCandidate.get(`${eid}__${ours.id}`)?.ours ?? 0 : 0;
    const rivalSpend = rival ? spendByCandidate.get(`${eid}__${rival.id}`)?.rival ?? 0 : 0;

    races.push({
      electionId: eid,
      office,
      seatLabel: seatLabel(office, el.district_code as string | null, el.state as string | null),
      phase: String(el.phase),
      ourCandidateId: ours?.id ?? null,
      ourCandidateName: ours ? candidateName(ours, nameBy) : "—",
      rivalCandidateId: rival?.id ?? null,
      rivalCandidateName: rival ? candidateName(rival, nameBy) : "—",
      ourPacSpend: ourSpend,
      rivalPacSpend: rivalSpend,
      generalClosesAt: (el.general_closes_at as string | null) ?? null,
    });
  }

  const { data: rivalFilingsRaw } = await supabase
    .from("pac_contributions")
    .select(
      "id, election_id, candidate_id, amount, campaign_points, target_state, disclosed_at, contributor_label",
    )
    .eq("funded_by_rival", true)
    .eq("is_dark", false)
    .order("disclosed_at", { ascending: false })
    .limit(12);

  const electionById = new Map(
    electionRows.map((e) => [
      e.id as string,
      seatLabel(String(e.office), e.district_code as string | null, e.state as string | null),
    ]),
  );

  const recentRivalFilings: RivalPacFilingRow[] = (rivalFilingsRaw ?? []).map((raw) => {
    const row = raw as {
      id: string;
      election_id: string;
      candidate_id: string;
      amount: number;
      campaign_points: number;
      target_state: string | null;
      disclosed_at: string;
      contributor_label: string | null;
    };
    const cand = candRows.find((c) => c.id === row.candidate_id);
    return {
      id: row.id,
      electionId: row.election_id,
      seatLabel: electionById.get(row.election_id) ?? row.election_id.slice(0, 8),
      candidateName: cand ? candidateName(cand, nameBy) : "Candidate",
      amount: Number(row.amount),
      campaignPoints: Number(row.campaign_points),
      targetState: row.target_state?.trim().toUpperCase() || null,
      disclosedAt: row.disclosed_at,
      contributorLabel: row.contributor_label?.trim() || status.rivalLabel,
    };
  });

  const legislativeRound = await loadLegislativeRoundBundle(supabase, humanParty);

  return {
    status,
    dayCycle: getCampaignDayCycle(),
    chamber,
    races,
    recentRivalFilings,
    rivalIntel: await loadRivalIntel(supabase),
    strategistBills: await loadStrategistBills(supabase),
    presidentElectionId,
    pacTargets: [],
    pacFundingSummaries: [],
    pacStates: [],
    generalElectionOpen: false,
    economyFrozen: false,
    hasPac: Boolean(status.myPacName),
    legislativeRound,
  };
}

async function loadRivalIntel(supabase: SupabaseClient): Promise<RivalIntelRow[]> {
  const { data } = await supabase
    .from("rival_strategist_actions")
    .select("id, action_kind, summary, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  return (data ?? []).map((raw) => {
    const row = raw as {
      id: string;
      action_kind: string;
      summary: string;
      metadata: Record<string, unknown> | null;
      created_at: string;
    };
    return {
      id: row.id,
      kind: row.action_kind,
      summary: row.summary,
      createdAt: row.created_at,
      metadata: row.metadata ?? {},
    };
  });
}

async function loadStrategistBills(supabase: SupabaseClient): Promise<StrategistBillRow[]> {
  const { data } = await supabase
    .from("bills")
    .select("id, title, originating_chamber, status, strategist_sponsor_label, strategist_party, filed_by_party_strategist, created_at")
    .eq("filed_by_party_strategist", true)
    .order("created_at", { ascending: false })
    .limit(12);

  return (data ?? []).map((raw) => {
    const row = raw as {
      id: string;
      title: string;
      originating_chamber: string;
      status: string;
      strategist_sponsor_label: string | null;
      strategist_party: string | null;
      created_at: string;
    };
    return {
      id: row.id,
      title: row.title,
      chamber: row.originating_chamber,
      status: row.status,
      sponsorLabel: row.strategist_sponsor_label,
      party: row.strategist_party,
      isRival: row.strategist_party === "republican",
      createdAt: row.created_at,
    };
  });
}

export async function loadCampaignWarRoomHub(
  supabase: SupabaseClient,
  userId: string,
): Promise<CampaignWarRoomData> {
  const base = await loadCampaignWarRoom(supabase, userId);
  const humanParty = base.status.humanParty;

  const [{ data: activeFy }, { data: pacRpc }, { data: stateRows }] = await Promise.all([
    supabase.from("rp_fiscal_years").select("economy_activity_frozen").eq("status", "active").maybeSingle(),
    supabase.rpc("pac_my_status"),
    supabase.from("states").select("code, name").order("code"),
  ]);

  const pacTargets = await loadPacContributionTargets(supabase, userId, { party: humanParty });
  const pacFundingSummaries = await loadPacCandidateFundingSummaries(supabase, userId, pacTargets);
  const generalElectionOpen = await loadPacGeneralElectionOpen(supabase);

  const pacStatus = (pacRpc as { has_pac?: boolean } | null) ?? {};

  return {
    ...base,
    pacTargets,
    pacFundingSummaries,
    pacStates: (stateRows ?? []).map((s) => ({
      code: String(s.code).trim().toUpperCase(),
      name: String(s.name),
    })),
    generalElectionOpen,
    economyFrozen: Boolean((activeFy as { economy_activity_frozen?: boolean } | null)?.economy_activity_frozen),
    hasPac: Boolean(pacStatus.has_pac),
  };
}
