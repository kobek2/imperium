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
        "id, title, content_md, status, originating_chamber, created_at, expires_at, leadership_deadline_at, chamber_vote_deadline_at, vp_tie_break_pending",
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
