import type { SupabaseClient } from "@supabase/supabase-js";
import { receivingChamberForOrigination } from "@/lib/legislative-helpers";
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

const NON_CHAMBER_BILL_STATUSES = new Set([
  "oval",
  "passed_congress",
  "law",
  "signed",
  "vetoed",
  "dead",
  "failed",
  "expired",
  "rejected",
]);

/** Positive filter so terminal bills do not consume the PostgREST row cap (default 1000). */
const CONGRESS_PIPELINE_STATUSES = [
  "submitted",
  "leadership_review",
  "on_docket",
  "debate",
  "house_floor",
  "senate_floor",
  "other_chamber_review",
  "other_chamber_debate",
  "house_committee",
  "senate_committee",
] as const;

/** Bills listed under /congress/house: House filing pipeline + anything on the House floor (any origin). */
export function filterBillsForHouseDocket(bills: BillForCard[]): BillForCard[] {
  return bills.filter((b) => {
    if (NON_CHAMBER_BILL_STATUSES.has(b.status)) return false;
    if (b.status === "house_floor") return true;
    if (b.status === "senate_floor") return false;
    if (b.status === "other_chamber_review" || b.status === "other_chamber_debate") {
      return receivingChamberForOrigination(b.originating_chamber) === "house";
    }
    return b.originating_chamber === "house";
  });
}

/** Bills listed under /congress/senate: Senate filing pipeline + anything on the Senate floor (any origin). */
export function filterBillsForSenateDocket(bills: BillForCard[]): BillForCard[] {
  return bills.filter((b) => {
    if (NON_CHAMBER_BILL_STATUSES.has(b.status)) return false;
    if (b.status === "senate_floor") return true;
    if (b.status === "house_floor") return false;
    if (b.status === "other_chamber_review" || b.status === "other_chamber_debate") {
      return receivingChamberForOrigination(b.originating_chamber) === "senate";
    }
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
        "id, title, author_id, content_html, content_md, status, originating_chamber, created_at, expires_at, leadership_deadline_at, chamber_vote_deadline_at, vp_tie_break_pending",
      )
      .in("status", [...CONGRESS_PIPELINE_STATUSES])
      .order("chamber_vote_deadline_at", { ascending: true, nullsFirst: false })
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

  const authorIds = billList.map((b) => b.author_id).filter(Boolean);
  const voterIds = Array.from(new Set([...votes.map((v) => v.voter_id), ...authorIds]));
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
