import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isActivePresidentialRunningMate,
  userCanBreakSenateTie,
} from "@/lib/presidential-running-mate";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import type { BillForCard, BillVote, VoterProfile } from "./bill-card";

export type CongressLeadershipSession = { id: string; chamber: string; closes_at: string };

export type CongressDocketPayload = {
  billList: BillForCard[];
  votesByBill: Map<string, BillVote[]>;
  voterById: Map<string, VoterProfile>;
  roleKeys: string[];
  leadershipSessions: CongressLeadershipSession[];
  isRunningMate: boolean;
  canBreakSenateTie: boolean;
};

/** Bills listed under /congress/house: House filing pipeline + anything on the House floor (any origin). */
export function filterBillsForHouseDocket(bills: BillForCard[]): BillForCard[] {
  return bills.filter((b) => {
    if (b.status === "house_floor") return true;
    if (b.status === "senate_floor") return false;
    return b.originating_chamber === "house";
  });
}

/** Bills listed under /congress/senate: Senate filing pipeline + anything on the Senate floor (any origin). */
export function filterBillsForSenateDocket(bills: BillForCard[]): BillForCard[] {
  return bills.filter((b) => {
    if (b.status === "senate_floor") return true;
    if (b.status === "house_floor") return false;
    return b.originating_chamber === "senate";
  });
}

export async function loadCongressDocket(supabase: SupabaseClient, userId: string): Promise<CongressDocketPayload> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", userId)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, userId, profile);

  const [{ data: bills }, { data: leadershipSessions }, isRunningMate, canBreakSenateTie] = await Promise.all([
    supabase
      .from("bills")
      .select(
        "id, title, content_html, content_md, status, originating_chamber, created_at, expires_at, leadership_deadline_at, chamber_vote_deadline_at, vp_tie_break_pending",
      )
      .neq("status", "dead")
      .order("created_at", { ascending: false }),
    supabase.from("leadership_sessions").select("id, chamber, closes_at").eq("phase", "open"),
    isActivePresidentialRunningMate(supabase, userId),
    userCanBreakSenateTie(supabase, userId, roleKeys),
  ]);

  const billList = (bills ?? []) as BillForCard[];
  const billIds = billList.map((b) => b.id);

  let votes: BillVote[] = [];
  if (billIds.length) {
    const { data: rawVotes } = await supabase
      .from("bill_votes")
      .select("bill_id, voter_id, chamber, vote")
      .in("bill_id", billIds);
    votes = (rawVotes ?? []) as BillVote[];
  }

  const voterIds = Array.from(new Set(votes.map((v) => v.voter_id)));
  const voterById = new Map<string, VoterProfile>();
  if (voterIds.length) {
    const { data: voterProfiles } = await supabase
      .from("profiles")
      .select("id, character_name, party")
      .in("id", voterIds);
    for (const p of (voterProfiles ?? []) as VoterProfile[]) voterById.set(p.id, p);
  }

  const votesByBill = new Map<string, BillVote[]>();
  for (const v of votes) {
    const list = votesByBill.get(v.bill_id) ?? [];
    list.push(v);
    votesByBill.set(v.bill_id, list);
  }

  return {
    billList,
    votesByBill,
    voterById,
    roleKeys,
    leadershipSessions: (leadershipSessions ?? []) as CongressLeadershipSession[],
    isRunningMate,
    canBreakSenateTie,
  };
}
