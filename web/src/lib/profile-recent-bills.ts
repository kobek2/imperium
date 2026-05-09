import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillFloorYeaNayTally } from "@/lib/bill-types";

export type RecentAuthoredBill = {
  id: string;
  title: string;
  status: string;
  originating_chamber: "house" | "senate";
  created_at: string;
};

export type AuthorBillVote = {
  bill_id: string;
  chamber: "house" | "senate";
  vote: string;
};

function emptyTally(): BillFloorYeaNayTally {
  return { house_yea: 0, house_nay: 0, senate_yea: 0, senate_nay: 0 };
}

function aggregateFloorTallies(
  rows: Array<{ bill_id: string; chamber: string; vote: string }>,
): Map<string, BillFloorYeaNayTally> {
  const map = new Map<string, BillFloorYeaNayTally>();
  for (const v of rows) {
    if (v.vote !== "yea" && v.vote !== "nay") continue;
    const t = map.get(v.bill_id) ?? emptyTally();
    if (v.chamber === "house") {
      if (v.vote === "yea") t.house_yea++;
      else t.house_nay++;
    } else if (v.chamber === "senate") {
      if (v.vote === "yea") t.senate_yea++;
      else t.senate_nay++;
    }
    map.set(v.bill_id, t);
  }
  return map;
}

/** Last N bills filed by a member, plus that member's floor votes on those bills (if any). */
export async function fetchRecentAuthoredBillsWithSubjectVotes(
  supabase: SupabaseClient,
  authorId: string,
  limit = 5,
): Promise<{
  bills: RecentAuthoredBill[];
  votes: AuthorBillVote[];
  floorTallies: Map<string, BillFloorYeaNayTally>;
  /** Bill IDs that are (or were) Senate confirmation nominations. */
  confirmationBillIds: Set<string>;
}> {
  const { data: bills } = await supabase
    .from("bills")
    .select("id, title, status, originating_chamber, created_at")
    .eq("author_id", authorId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const list = (bills ?? []) as RecentAuthoredBill[];
  if (!list.length) {
    return { bills: [], votes: [], floorTallies: new Map(), confirmationBillIds: new Set() };
  }

  const billIds = list.map((b) => b.id);

  const [{ data: votes }, { data: allFloorVotes }, { data: apptRows }] = await Promise.all([
    supabase.from("bill_votes").select("bill_id, chamber, vote").eq("voter_id", authorId).in("bill_id", billIds),
    supabase
      .from("bill_votes")
      .select("bill_id, chamber, vote")
      .in("bill_id", billIds)
      .in("vote", ["yea", "nay"]),
    supabase.from("appointments").select("confirmation_bill_id").in("confirmation_bill_id", billIds),
  ]);

  const confirmationBillIds = new Set(
    (apptRows ?? []).map((r) => String((r as { confirmation_bill_id: string }).confirmation_bill_id)),
  );

  return {
    bills: list,
    votes: (votes ?? []) as AuthorBillVote[],
    floorTallies: aggregateFloorTallies((allFloorVotes ?? []) as Array<{ bill_id: string; chamber: string; vote: string }>),
    confirmationBillIds,
  };
}
