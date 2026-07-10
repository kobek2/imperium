import type { SupabaseClient } from "@supabase/supabase-js";

export type CaucusMemberRow = {
  simPoliticianId: string;
  name: string;
  party: string;
  chamber: string;
  seatLabel: string;
  politicalCapital: number;
  whipLoyalty: number;
};

export type LegislativeRoundStatus = {
  seasonActive: boolean;
  cstPhase: string;
  cstDate: string | null;
  campaignCycle: number;
  campaignTurn: number;
  leadershipRequired: boolean;
  featuredIssueKeys: string[];
  crossAisleFlips: number;
  crossAisleFlipLimit: number;
  roundId: string | null;
  roundPhase: string | null;
  activeBillId: string | null;
  leadershipResolved: boolean;
  humanProposalSubmitted: boolean;
  rivalProposalSubmitted: boolean;
  houseMajorityParty: string | null;
  myPoliticalCapital: number;
  rivalPoliticalCapital: number;
  caucusCount: number;
  presidentSimId: string | null;
  presidentName: string | null;
  presidentParty: string | null;
  presidentCapital: number;
  mayorSimId: string | null;
  mayorName: string | null;
  mayorParty: string | null;
  mayorCapital: number;
  councilMajorityParty: string | null;
};

export type RoundBillRow = {
  id: string;
  party: string;
  title: string;
  summary: string;
  issueKey: string | null;
  stanceKey: string | null;
  policyValue: number | null;
  docketOrder: number;
  sponsorName: string;
  houseYeas: number;
  houseNays: number;
  senateYeas: number;
  senateNays: number;
  housePassed: boolean;
  senatePassed: boolean;
  signed: boolean;
  vetoed: boolean;
};

export type LeadershipNomRow = {
  roleKey: string;
  simPoliticianId: string;
  name: string;
  party: string;
  won: boolean;
};

export type RollCallRow = {
  billId: string;
  chamber: "house" | "senate" | "council";
  simPoliticianId: string;
  name: string;
  party: string;
  vote: "yea" | "nay";
  method: string;
};

export type VoteAssignmentRow = {
  simPoliticianId: string;
  vote: "yea" | "nay";
  method: string;
};

export type LegislativeRoundBundle = {
  status: LegislativeRoundStatus;
  caucus: CaucusMemberRow[];
  bills: RoundBillRow[];
  leadership: LeadershipNomRow[];
  rollCalls: RollCallRow[];
  voteAssignments: VoteAssignmentRow[];
  humanParty: string;
};

function parseRoundStatus(raw: unknown): LegislativeRoundStatus {
  const r = (raw ?? {}) as Record<string, unknown>;
  const featured = r.featured_issue_keys;
  return {
    seasonActive: Boolean(r.season_active),
    cstPhase: String(r.cst_phase ?? ""),
    cstDate: (r.cst_date as string | null) ?? null,
    campaignCycle: Number(r.campaign_cycle ?? 1),
    campaignTurn: Number(r.campaign_turn ?? 1),
    leadershipRequired: Boolean(r.leadership_required),
    featuredIssueKeys: Array.isArray(featured) ? featured.map(String) : [],
    crossAisleFlips: Number(r.cross_aisle_flips ?? 0),
    crossAisleFlipLimit: Number(r.cross_aisle_flip_limit ?? 1),
    roundId: (r.round_id as string | null) ?? null,
    roundPhase: (r.round_phase as string | null) ?? null,
    activeBillId: (r.active_bill_id as string | null) ?? null,
    leadershipResolved: Boolean(r.leadership_resolved),
    humanProposalSubmitted: Boolean(r.human_proposal_submitted),
    rivalProposalSubmitted: Boolean(r.rival_proposal_submitted),
    houseMajorityParty: (r.house_majority_party as string | null) ?? null,
    myPoliticalCapital: Number(r.my_political_capital ?? 0),
    rivalPoliticalCapital: Number(r.rival_political_capital ?? 0),
    caucusCount: Number(r.caucus_count ?? 0),
    presidentSimId: (r.president_sim_id as string | null) ?? (r.mayor_sim_id as string | null) ?? null,
    presidentName: (r.president_name as string | null) ?? (r.mayor_name as string | null) ?? null,
    presidentParty: (r.president_party as string | null) ?? (r.mayor_party as string | null) ?? null,
    presidentCapital: Number(r.president_capital ?? r.mayor_capital ?? 0),
    mayorSimId: (r.mayor_sim_id as string | null) ?? (r.president_sim_id as string | null) ?? null,
    mayorName: (r.mayor_name as string | null) ?? (r.president_name as string | null) ?? null,
    mayorParty: (r.mayor_party as string | null) ?? (r.president_party as string | null) ?? null,
    mayorCapital: Number(r.mayor_capital ?? r.president_capital ?? 0),
    councilMajorityParty: (r.council_majority_party as string | null) ?? (r.house_majority_party as string | null) ?? null,
  };
}

export async function loadLegislativeRoundBundle(
  supabase: SupabaseClient,
  humanParty: string,
): Promise<LegislativeRoundBundle> {
  const { data: statusRaw } = await supabase.rpc("campaign_legislative_round_status");
  const status = parseRoundStatus(statusRaw);

  const { data: caucusRaw } = await supabase
    .from("campaign_caucus_members")
    .select("sim_politician_id, chamber, party, seat_label")
    .order("sort_order");

  const simIds = (caucusRaw ?? []).map((r) => (r as { sim_politician_id: string }).sim_politician_id);
  const { data: simRows } = simIds.length
    ? await supabase
        .from("sim_politicians")
        .select("id, character_name, political_capital, whip_loyalty")
        .in("id", simIds)
    : { data: [] };
  const simById = new Map(
    (simRows ?? []).map((s) => [
      (s as { id: string }).id,
      s as { character_name: string; political_capital: number; whip_loyalty: number },
    ]),
  );

  const caucus: CaucusMemberRow[] = (caucusRaw ?? []).map((row) => {
    const r = row as {
      sim_politician_id: string;
      chamber: string;
      party: string;
      seat_label: string;
    };
    const sp = simById.get(r.sim_politician_id);
    return {
      simPoliticianId: r.sim_politician_id,
      name: sp?.character_name ?? "NPC",
      party: r.party,
      chamber: r.chamber,
      seatLabel: r.seat_label,
      politicalCapital: Number(sp?.political_capital ?? 0),
      whipLoyalty: Number(sp?.whip_loyalty ?? 50),
    };
  });

  let bills: RoundBillRow[] = [];
  let leadership: LeadershipNomRow[] = [];
  let rollCalls: RollCallRow[] = [];
  let voteAssignments: VoteAssignmentRow[] = [];

  if (status.roundId) {
    const [{ data: billRows }, { data: leadRows }, { data: rollRows }, { data: overrideRows }] = await Promise.all([
      supabase
        .from("legislative_round_bills")
        .select(
          "id, party, title, summary, issue_key, stance_key, policy_value, docket_order, house_yeas, house_nays, senate_yeas, senate_nays, house_passed, senate_passed, signed, vetoed, sponsor_sim_politician_id",
        )
        .eq("round_id", status.roundId)
        .order("created_at"),
      supabase
        .from("legislative_round_leadership")
        .select("role_key, sim_politician_id, party, won")
        .eq("round_id", status.roundId),
      supabase
        .from("legislative_round_roll_calls")
        .select("bill_id, chamber, sim_politician_id, vote, method")
        .eq("round_id", status.roundId)
        .order("chamber")
        .order("created_at"),
      status.activeBillId && (status.roundPhase === "council_vote" || status.roundPhase === "house_vote" || status.roundPhase === "senate_vote")
        ? supabase
            .from("legislative_round_vote_overrides")
            .select("sim_politician_id, vote, method")
            .eq("round_id", status.roundId)
            .eq("bill_id", status.activeBillId)
        : Promise.resolve({ data: [] }),
    ]);

    const sponsorIds = [...new Set((billRows ?? []).map((b) => (b as { sponsor_sim_politician_id: string }).sponsor_sim_politician_id))];
    const leadSimIds = [...new Set((leadRows ?? []).map((l) => (l as { sim_politician_id: string }).sim_politician_id))];
    const extraIds = [...new Set([...sponsorIds, ...leadSimIds])].filter((id) => !simById.has(id));
    if (extraIds.length) {
      const { data: extraSims } = await supabase
        .from("sim_politicians")
        .select("id, character_name")
        .in("id", extraIds);
      for (const s of extraSims ?? []) {
        simById.set((s as { id: string }).id, {
          character_name: (s as { character_name: string }).character_name,
          political_capital: 0,
          whip_loyalty: 50,
        });
      }
    }

    bills = (billRows ?? []).map((raw) => {
      const b = raw as {
        id: string;
        party: string;
        title: string;
        summary: string;
        issue_key: string | null;
        stance_key: string | null;
        policy_value: number | null;
        docket_order: number;
        house_yeas: number;
        house_nays: number;
        senate_yeas: number;
        senate_nays: number;
        house_passed: boolean;
        senate_passed: boolean;
        signed: boolean;
        vetoed: boolean;
        sponsor_sim_politician_id: string;
      };
      return {
        id: b.id,
        party: b.party,
        title: b.title,
        summary: b.summary,
        issueKey: b.issue_key,
        stanceKey: b.stance_key,
        policyValue: b.policy_value != null ? Number(b.policy_value) : null,
        docketOrder: Number(b.docket_order ?? 1),
        sponsorName: simById.get(b.sponsor_sim_politician_id)?.character_name ?? "NPC",
        houseYeas: b.house_yeas,
        houseNays: b.house_nays,
        senateYeas: b.senate_yeas,
        senateNays: b.senate_nays,
        housePassed: b.house_passed,
        senatePassed: b.senate_passed,
        signed: b.signed,
        vetoed: b.vetoed,
      };
    });

    leadership = (leadRows ?? []).map((raw) => {
      const l = raw as {
        role_key: string;
        sim_politician_id: string;
        party: string;
        won: boolean;
      };
      return {
        roleKey: l.role_key,
        simPoliticianId: l.sim_politician_id,
        name: simById.get(l.sim_politician_id)?.character_name ?? "NPC",
        party: l.party,
        won: l.won,
      };
    });

    rollCalls = (rollRows ?? []).map((raw) => {
      const r = raw as {
        bill_id: string;
        chamber: string;
        sim_politician_id: string;
        vote: string;
        method: string;
      };
      const member = caucus.find((c) => c.simPoliticianId === r.sim_politician_id);
      return {
        billId: r.bill_id,
        chamber: (r.chamber === "house" ? "council" : r.chamber) as "house" | "senate" | "council",
        simPoliticianId: r.sim_politician_id,
        name: member?.name ?? simById.get(r.sim_politician_id)?.character_name ?? "NPC",
        party: member?.party ?? "",
        vote: r.vote as "yea" | "nay",
        method: r.method,
      };
    });

    voteAssignments = (overrideRows ?? []).map((raw) => {
      const o = raw as { sim_politician_id: string; vote: string; method: string };
      return {
        simPoliticianId: o.sim_politician_id,
        vote: o.vote as "yea" | "nay",
        method: o.method,
      };
    });
  }

  return { status, caucus, bills, leadership, rollCalls, voteAssignments, humanParty };
}

export function phaseLabel(phase: string | null): string {
  if (!phase) return "No round";
  const map: Record<string, string> = {
    leadership: "1 · Council Spokesperson election",
    proposals: "2 · Propose ordinances",
    council_vote: "3 · Council floor vote",
    mayoral: "4 · Mayor sign / veto",
    completed: "Round complete",
    house_vote: "3 · Council floor vote",
    senate_vote: "3 · Council floor vote",
    presidential: "4 · Mayor sign / veto",
  };
  return map[phase] ?? phase;
}
