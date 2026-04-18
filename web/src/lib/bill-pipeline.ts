import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillChamber } from "@/lib/bill-types";

function isMissingBillTimerColumn(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("leadership_deadline_at") || m.includes("chamber_vote_deadline_at");
}

async function tallyChamberPass(
  supabase: SupabaseClient,
  billId: string,
  chamber: BillChamber,
): Promise<boolean> {
  const { data: votes } = await supabase
    .from("bill_votes")
    .select("vote")
    .eq("bill_id", billId)
    .eq("chamber", chamber);

  let yea = 0;
  let nay = 0;
  for (const v of votes ?? []) {
    if (v.vote === "yea") yea += 1;
    else if (v.vote === "nay") nay += 1;
  }
  return yea > nay;
}

/** Advance bills whose leadership or chamber clocks have expired. */
export async function processBillDeadlines(supabase: SupabaseClient): Promise<void> {
  const nowIso = new Date().toISOString();

  const hopperStaleRes = await supabase
    .from("bills")
    .select("id")
    .eq("status", "hopper")
    .not("leadership_deadline_at", "is", null)
    .lt("leadership_deadline_at", nowIso);

  if (hopperStaleRes.error) {
    if (isMissingBillTimerColumn(hopperStaleRes.error.message)) {
      // Older databases without the timer columns can't process deadlines here; the
      // bills table's pre-timer migration handled this differently. Skip silently.
      return;
    }
    console.warn("[processBillDeadlines] hopperStale:", hopperStaleRes.error.message);
    return;
  }
  const hopperStale = hopperStaleRes.data;

  for (const row of hopperStale ?? []) {
    await supabase.from("bills").update({ status: "dead" }).eq("id", row.id);
  }

  const { data: houseFloor } = await supabase
    .from("bills")
    .select("id, originating_chamber")
    .eq("status", "house_floor")
    .not("chamber_vote_deadline_at", "is", null)
    .lt("chamber_vote_deadline_at", nowIso);

  for (const bill of houseFloor ?? []) {
    const pass = await tallyChamberPass(supabase, bill.id, "house");
    if (!pass) {
      await supabase.from("bills").update({ status: "dead", chamber_vote_deadline_at: null }).eq("id", bill.id);
      continue;
    }
    if (bill.originating_chamber === "house") {
      await supabase
        .from("bills")
        .update({
          status: "senate_floor",
          chamber_vote_deadline_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq("id", bill.id);
    } else {
      await supabase
        .from("bills")
        .update({ status: "oval", chamber_vote_deadline_at: null })
        .eq("id", bill.id);
    }
  }

  const { data: senateFloor } = await supabase
    .from("bills")
    .select("id, originating_chamber")
    .eq("status", "senate_floor")
    .not("chamber_vote_deadline_at", "is", null)
    .lt("chamber_vote_deadline_at", nowIso);

  for (const bill of senateFloor ?? []) {
    const pass = await tallyChamberPass(supabase, bill.id, "senate");
    if (!pass) {
      await supabase.from("bills").update({ status: "dead", chamber_vote_deadline_at: null }).eq("id", bill.id);
      continue;
    }
    if (bill.originating_chamber === "senate") {
      await supabase
        .from("bills")
        .update({
          status: "house_floor",
          chamber_vote_deadline_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq("id", bill.id);
    } else {
      await supabase
        .from("bills")
        .update({ status: "oval", chamber_vote_deadline_at: null })
        .eq("id", bill.id);
    }
  }
}
