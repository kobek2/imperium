import type { BillVote, BillForCard } from "@/app/(app)/congress/bill-card";
import { filterBillsForHouseDocket, filterBillsForSenateDocket } from "@/app/(app)/congress/load-congress-docket";
import { receivingChamberForOrigination } from "@/lib/legislative-helpers";
import { isActivePresidentialRunningMate, userCanBreakSenateTie } from "@/lib/presidential-running-mate";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { canAcceptRejectHopperForChamber, canReviewAnyChamberLeadership } from "@/lib/role-capabilities";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";

/** Minimal bill row for attention heuristics (matches `bill-card` leadership controls). */
export type BillAttentionRow = {
  id: string;
  status: string;
  originating_chamber: "house" | "senate";
  vp_tie_break_pending?: boolean | null;
};

export function resolveCongressUserChambers(roleKeys: string[]): Array<"house" | "senate"> {
  const rk = new Set(roleKeys);
  const chambers: Array<"house" | "senate"> = [];
  if (rk.has("representative") || rk.has("president") || rk.has("admin")) chambers.push("house");
  if (rk.has("senator") || rk.has("admin")) chambers.push("senate");
  return chambers;
}

/**
 * Hopper / docket / debate scheduling — everything leadership can do **before** treating the bill as
 * an active floor roll call (close-vote is separate for badge routing).
 */
export function hasLeadershipPreVoteAction(roleKeys: string[], bill: BillAttentionRow): boolean {
  const originatingChamber = bill.originating_chamber;
  const receivingChamber = receivingChamberForOrigination(originatingChamber);
  const canActOriginatingLeadership = canAcceptRejectHopperForChamber(roleKeys, originatingChamber);
  const canActReceivingLeadership = canAcceptRejectHopperForChamber(roleKeys, receivingChamber);

  if (
    (bill.status === "submitted" || bill.status === "leadership_review") &&
    canActOriginatingLeadership
  ) {
    return true;
  }

  if (bill.status === "other_chamber_review" && canActReceivingLeadership) {
    return true;
  }

  const openVoteChamber =
    bill.status === "other_chamber_debate"
      ? receivingChamber
      : bill.status === "on_docket" || bill.status === "debate"
        ? originatingChamber
        : null;
  const canOpenVote =
    openVoteChamber != null && canAcceptRejectHopperForChamber(roleKeys, openVoteChamber);

  if (
    (bill.status === "on_docket" || bill.status === "debate" || bill.status === "other_chamber_debate") &&
    canOpenVote
  ) {
    return true;
  }

  return false;
}

/** Ending an open floor vote period (leadership only). Counted on Congress, not Hopper. */
export function hasLeadershipCloseFloorVoteAction(roleKeys: string[], bill: BillAttentionRow): boolean {
  const closeVoteChamber =
    bill.status === "house_floor" ? "house" : bill.status === "senate_floor" ? "senate" : null;
  const canCloseVote =
    closeVoteChamber != null && canAcceptRejectHopperForChamber(roleKeys, closeVoteChamber);

  return (bill.status === "house_floor" || bill.status === "senate_floor") && canCloseVote;
}

/** Mirrors `BillCard` leadership action visibility (hopper through close vote). */
export function hasLeadershipActionOnBill(roleKeys: string[], bill: BillAttentionRow): boolean {
  return hasLeadershipPreVoteAction(roleKeys, bill) || hasLeadershipCloseFloorVoteAction(roleKeys, bill);
}

export function memberNeedsToCastFloorVote(params: {
  bill: BillAttentionRow;
  votes: BillVote[];
  userId: string;
  userChambers: Array<"house" | "senate">;
  isRunningMate: boolean;
  canBreakSenateTie: boolean;
}): boolean {
  const { bill, votes, userId, userChambers, isRunningMate, canBreakSenateTie } = params;

  if (bill.status === "house_floor") {
    if (!userChambers.includes("house")) return false;
    return !votes.some((v) => v.chamber === "house" && v.voter_id === userId);
  }

  if (bill.status === "senate_floor") {
    if (bill.vp_tie_break_pending) {
      if (!canBreakSenateTie) return false;
      return !votes.some((v) => v.chamber === "senate" && v.voter_id === userId);
    }
    if (!userChambers.includes("senate") || isRunningMate) return false;
    return !votes.some((v) => v.chamber === "senate" && v.voter_id === userId);
  }

  return false;
}

export function billNeedsViewerAttention(params: {
  bill: BillAttentionRow;
  votes: BillVote[];
  userId: string;
  roleKeys: string[];
  userChambers: Array<"house" | "senate">;
  isRunningMate: boolean;
  canBreakSenateTie: boolean;
}): boolean {
  const { bill, votes, userId, roleKeys, userChambers, isRunningMate, canBreakSenateTie } = params;
  if (hasLeadershipCloseFloorVoteAction(roleKeys, bill)) return true;
  return memberNeedsToCastFloorVote({
    bill,
    votes,
    userId,
    userChambers,
    isRunningMate: false,
    canBreakSenateTie,
  });
}

export type CongressAttentionSnapshot = {
  isLeadership: boolean;
  /**
   * Top-level Congress nav: floor stage only — your missing floor ballot, or (for leadership)
   * bills awaiting "close vote" on an open roll call.
   */
  congressPrimaryBadge: number;
  /**
   * Hopper nav / leadership desk: filings through debate — hopper accept/reject, docket moves,
   * scheduling open votes, **plus** bills sitting in debate for awareness. Excludes active floor
   * roll calls (those move to `congressPrimaryBadge`).
   */
  hopperLeadershipBadge: number;
  overviewCount: number;
  houseChamberCount: number;
  senateChamberCount: number;
};

const PIPELINE_STATUSES = [
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

export async function fetchCongressAttentionSnapshot(
  supabase: SupabaseClient,
  userId: string,
): Promise<CongressAttentionSnapshot | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", userId)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, userId, profile);
  const userChambers = resolveCongressUserChambers(roleKeys);

  const [{ data: pipelineBills }, isRunningMate, canBreakSenateTie] = await Promise.all([
    supabase
      .from("bills")
      .select("id, status, originating_chamber, vp_tie_break_pending")
      .in("status", [...PIPELINE_STATUSES])
      .limit(4000),
    isActivePresidentialRunningMate(supabase, userId),
    userCanBreakSenateTie(supabase, userId, roleKeys),
  ]);

  const bills = (pipelineBills ?? []) as BillAttentionRow[];
  const floorIds = bills.filter((b) => b.status === "house_floor" || b.status === "senate_floor").map((b) => b.id);

  let myFloorVotes: BillVote[] = [];
  if (floorIds.length) {
    const { data: vrows } = await supabase
      .from("bill_votes")
      .select("bill_id, voter_id, chamber, vote")
      .eq("voter_id", userId)
      .in("bill_id", floorIds);
    myFloorVotes = (vrows ?? []) as BillVote[];
  }

  const votesByBill = new Map<string, BillVote[]>();
  for (const v of myFloorVotes) {
    const list = votesByBill.get(v.bill_id) ?? [];
    list.push(v);
    votesByBill.set(v.bill_id, list);
  }

  const attentionBills: BillForCard[] = [];
  const voteStageIds = new Set<string>();

  for (const b of bills) {
    const votes = votesByBill.get(b.id) ?? [];
    const closeFloorLeadership = hasLeadershipCloseFloorVoteAction(roleKeys, b);
    const voteNeed = memberNeedsToCastFloorVote({
      bill: b,
      votes,
      userId,
      userChambers,
      isRunningMate: false,
      canBreakSenateTie,
    });

    if (voteNeed || closeFloorLeadership) {
      voteStageIds.add(b.id);
      attentionBills.push({
        id: b.id,
        title: "",
        author_id: "",
        content_md: "",
        status: b.status,
        originating_chamber: b.originating_chamber,
        created_at: "",
        leadership_deadline_at: null,
        chamber_vote_deadline_at: null,
        vp_tie_break_pending: b.vp_tie_break_pending ?? null,
      });
    }
  }

  const overviewCount = attentionBills.length;
  const houseChamberCount = filterBillsForHouseDocket(attentionBills).length;
  const senateChamberCount = filterBillsForSenateDocket(attentionBills).length;

  const congressPrimaryBadge = voteStageIds.size;

  return {
    isLeadership: false,
    congressPrimaryBadge,
    hopperLeadershipBadge: 0,
    overviewCount,
    houseChamberCount,
    senateChamberCount,
  };
}

/** Dedupe snapshot fetches within a single request (e.g. app chrome + congress layout). */
export const getCongressAttentionSnapshotForRequest = cache((supabase: SupabaseClient, userId: string) =>
  fetchCongressAttentionSnapshot(supabase, userId),
);
