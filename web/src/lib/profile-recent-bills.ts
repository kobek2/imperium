import type { SupabaseClient } from "@supabase/supabase-js";

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

/** Last N bills filed by a member, plus that member's floor votes on those bills (if any). */
export async function fetchRecentAuthoredBillsWithSubjectVotes(
  supabase: SupabaseClient,
  authorId: string,
  limit = 5,
): Promise<{ bills: RecentAuthoredBill[]; votes: AuthorBillVote[] }> {
  const { data: bills } = await supabase
    .from("bills")
    .select("id, title, status, originating_chamber, created_at")
    .eq("author_id", authorId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const list = (bills ?? []) as RecentAuthoredBill[];
  if (!list.length) {
    return { bills: [], votes: [] };
  }

  const { data: votes } = await supabase
    .from("bill_votes")
    .select("bill_id, chamber, vote")
    .eq("voter_id", authorId)
    .in(
      "bill_id",
      list.map((b) => b.id),
    );

  return { bills: list, votes: (votes ?? []) as AuthorBillVote[] };
}
