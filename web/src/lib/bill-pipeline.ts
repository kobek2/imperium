import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillChamber } from "@/lib/bill-types";

function isMissingBillTimerColumn(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("leadership_deadline_at") || m.includes("chamber_vote_deadline_at");
}

function isMissingVpTieColumn(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("vp_tie_break_pending");
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

async function tallySenateYeasNays(
  supabase: SupabaseClient,
  billId: string,
): Promise<{ yea: number; nay: number }> {
  const { data: votes } = await supabase
    .from("bill_votes")
    .select("vote")
    .eq("bill_id", billId)
    .eq("chamber", "senate");

  let yea = 0;
  let nay = 0;
  for (const v of votes ?? []) {
    if (v.vote === "yea") yea += 1;
    else if (v.vote === "nay") nay += 1;
  }
  return { yea, nay };
}

async function advanceSenateBillAfterPass(
  supabase: SupabaseClient,
  bill: { id: string; originating_chamber: string },
): Promise<void> {
  if (bill.originating_chamber === "senate") {
    let { error } = await supabase
      .from("bills")
      .update({
        status: "house_floor",
        chamber_vote_deadline_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        vp_tie_break_pending: false,
      })
      .eq("id", bill.id);
    if (error && isMissingVpTieColumn(error.message)) {
      const retry = await supabase
        .from("bills")
        .update({
          status: "house_floor",
          chamber_vote_deadline_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq("id", bill.id);
      error = retry.error;
    }
    if (error) throw new Error(error.message);
  } else {
    let { error } = await supabase
      .from("bills")
      .update({ status: "oval", chamber_vote_deadline_at: null, vp_tie_break_pending: false })
      .eq("id", bill.id);
    if (error && isMissingVpTieColumn(error.message)) {
      const retry = await supabase
        .from("bills")
        .update({ status: "oval", chamber_vote_deadline_at: null })
        .eq("id", bill.id);
      error = retry.error;
    }
    if (error) throw new Error(error.message);
  }
}

/** After the VP / running mate casts, close out a tied Senate floor if yea and nay now differ. */
export async function resolveSenateAfterTiebreakVote(
  supabase: SupabaseClient,
  billId: string,
): Promise<void> {
  const { data: bill } = await supabase
    .from("bills")
    .select("id, status, originating_chamber, vp_tie_break_pending")
    .eq("id", billId)
    .maybeSingle();

  if (!bill || bill.status !== "senate_floor") return;

  const pending = bill.vp_tie_break_pending === true;
  if (!pending) return;

  const { yea, nay } = await tallySenateYeasNays(supabase, billId);
  if (yea === nay) return;

  if (yea < nay) {
    let { error } = await supabase
      .from("bills")
      .update({ status: "dead", chamber_vote_deadline_at: null, vp_tie_break_pending: false })
      .eq("id", billId);
    if (error && isMissingVpTieColumn(error.message)) {
      const retry = await supabase
        .from("bills")
        .update({ status: "dead", chamber_vote_deadline_at: null })
        .eq("id", billId);
      error = retry.error;
    }
    if (error) console.warn("[resolveSenateAfterTiebreakVote]", error.message);
    return;
  }

  try {
    await advanceSenateBillAfterPass(supabase, bill);
  } catch (e) {
    console.warn("[resolveSenateAfterTiebreakVote] advance:", e);
  }
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

  const senateFloorRes = await supabase
    .from("bills")
    .select("id, originating_chamber, vp_tie_break_pending")
    .eq("status", "senate_floor")
    .not("chamber_vote_deadline_at", "is", null)
    .lt("chamber_vote_deadline_at", nowIso);

  if (senateFloorRes.error) {
    if (isMissingVpTieColumn(senateFloorRes.error.message)) {
      const { data: senateFloorLegacy } = await supabase
        .from("bills")
        .select("id, originating_chamber")
        .eq("status", "senate_floor")
        .not("chamber_vote_deadline_at", "is", null)
        .lt("chamber_vote_deadline_at", nowIso);
      for (const bill of senateFloorLegacy ?? []) {
        const { data: pendingAppt } = await supabase
          .from("appointments")
          .select("id")
          .eq("confirmation_bill_id", bill.id)
          .eq("status", "pending")
          .maybeSingle();

        if (pendingAppt) {
          const { error: rpcErr } = await supabase.rpc("apply_appointment_confirmation", {
            p_bill_id: bill.id,
          });
          if (rpcErr) {
            console.warn(
              "[processBillDeadlines] apply_appointment_confirmation:",
              bill.id,
              rpcErr.message,
            );
          }
          continue;
        }

        const pass = await tallyChamberPass(supabase, bill.id, "senate");
        if (!pass) {
          await supabase.from("bills").update({ status: "dead", chamber_vote_deadline_at: null }).eq("id", bill.id);
          continue;
        }
        await advanceSenateBillAfterPass(supabase, bill);
      }
      return;
    }
    console.warn("[processBillDeadlines] senateFloor:", senateFloorRes.error.message);
    return;
  }

  const senateFloor = senateFloorRes.data ?? [];

  for (const bill of senateFloor ?? []) {
    if (bill.vp_tie_break_pending) continue;

    const { data: pendingAppt } = await supabase
      .from("appointments")
      .select("id")
      .eq("confirmation_bill_id", bill.id)
      .eq("status", "pending")
      .maybeSingle();

    if (pendingAppt) {
      const { error: rpcErr } = await supabase.rpc("apply_appointment_confirmation", {
        p_bill_id: bill.id,
      });
      if (rpcErr) {
        console.warn(
          "[processBillDeadlines] apply_appointment_confirmation:",
          bill.id,
          rpcErr.message,
        );
      }
      continue;
    }

    const { yea, nay } = await tallySenateYeasNays(supabase, bill.id);
    if (yea > nay) {
      await advanceSenateBillAfterPass(supabase, bill);
      continue;
    }
    if (nay > yea) {
      let { error } = await supabase
        .from("bills")
        .update({ status: "dead", chamber_vote_deadline_at: null })
        .eq("id", bill.id);
      if (error && isMissingVpTieColumn(error.message)) {
        const retry = await supabase
          .from("bills")
          .update({ status: "dead", chamber_vote_deadline_at: null })
          .eq("id", bill.id);
        error = retry.error;
      }
      if (error) console.warn("[processBillDeadlines] senate dead:", error.message);
      continue;
    }

    let { error: tieErr } = await supabase
      .from("bills")
      .update({ vp_tie_break_pending: true, chamber_vote_deadline_at: null })
      .eq("id", bill.id);
    if (tieErr && isMissingVpTieColumn(tieErr.message)) {
      const retry = await supabase
        .from("bills")
        .update({ status: "dead", chamber_vote_deadline_at: null })
        .eq("id", bill.id);
      tieErr = retry.error;
    }
    if (tieErr) console.warn("[processBillDeadlines] senate tie:", tieErr.message);
  }
}
