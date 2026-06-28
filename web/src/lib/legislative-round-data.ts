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
};

export type RoundBillRow = {
  id: string;
  party: string;
  title: string;
  summary: string;
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

export type LegislativeRoundBundle = {
  status: LegislativeRoundStatus;
  caucus: CaucusMemberRow[];
  bills: RoundBillRow[];
  leadership: LeadershipNomRow[];
  humanParty: string;
};

function parseRoundStatus(raw: unknown): LegislativeRoundStatus {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    seasonActive: Boolean(r.season_active),
    cstPhase: String(r.cst_phase ?? ""),
    cstDate: (r.cst_date as string | null) ?? null,
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
      whipLoyalty: Number(sp?.whip_loyalty ?? 75),
    };
  });

  let bills: RoundBillRow[] = [];
  let leadership: LeadershipNomRow[] = [];

  if (status.roundId) {
    const [{ data: billRows }, { data: leadRows }] = await Promise.all([
      supabase
        .from("legislative_round_bills")
        .select(
          "id, party, title, summary, house_yeas, house_nays, senate_yeas, senate_nays, house_passed, senate_passed, signed, vetoed, sponsor_sim_politician_id",
        )
        .eq("round_id", status.roundId)
        .order("created_at"),
      supabase
        .from("legislative_round_leadership")
        .select("role_key, sim_politician_id, party, won")
        .eq("round_id", status.roundId),
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
          whip_loyalty: 75,
        });
      }
    }

    bills = (billRows ?? []).map((raw) => {
      const b = raw as {
        id: string;
        party: string;
        title: string;
        summary: string;
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
  }

  return { status, caucus, bills, leadership, humanParty };
}

export function phaseLabel(phase: string | null): string {
  if (!phase) return "No round";
  const map: Record<string, string> = {
    leadership: "1 · Leadership nominations",
    proposals: "2 · Propose legislation",
    house_vote: "3 · House floor vote",
    senate_vote: "4 · Senate floor vote",
    presidential: "5 · Presidential action",
    completed: "Round complete",
  };
  return map[phase] ?? phase;
}
