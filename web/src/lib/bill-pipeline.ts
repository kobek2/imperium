import type { SupabaseClient } from "@supabase/supabase-js";
import { processVoteApproval } from "@/lib/approval-ratings";
import { countChamberVotingMembers } from "@/lib/congress-composition";
import type { BillChamber } from "@/lib/bill-types";
import { hoursFromNowIso, OTHER_CHAMBER_REVIEW_HOURS } from "@/lib/legislation-automation-constants";

const SENATE_CONFIRMATION_ROLE_KEYS = [
  "senator",
  "president_pro_tempore",
  "senate_majority_leader",
  "senate_majority_whip",
  "senate_minority_leader",
  "senate_minority_whip",
  "vice_president",
] as const;

function isMissingBillTimerColumn(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("leadership_deadline_at") || m.includes("chamber_vote_deadline_at");
}

function isMissingVpTieColumn(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("vp_tie_break_pending");
}

function isMissingLegislationMaintenanceRpc(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("legislation_run_maintenance") &&
    (m.includes("does not exist") || m.includes("schema cache") || m.includes("could not find"))
  );
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

async function countSenateConfirmationElectorate(supabase: SupabaseClient): Promise<number> {
  const [{ data: grants }, { data: profiles }] = await Promise.all([
    supabase.from("government_role_grants").select("user_id, role_key"),
    supabase.from("profiles").select("id, office_role"),
  ]);
  const ids = new Set<string>();
  const keySet = new Set<string>(SENATE_CONFIRMATION_ROLE_KEYS);
  for (const row of grants ?? []) {
    if (keySet.has(String((row as { role_key: string }).role_key))) {
      ids.add(String((row as { user_id: string }).user_id));
    }
  }
  for (const row of profiles ?? []) {
    const r = (row as { id: string; office_role: string | null }).office_role;
    if (r && keySet.has(r)) ids.add((row as { id: string }).id);
  }
  return ids.size;
}

async function tallyFloorYeasNaysAbstain(
  supabase: SupabaseClient,
  billId: string,
  chamber: BillChamber,
): Promise<{ yea: number; nay: number; abstain: number; cast: number }> {
  const { data: votes } = await supabase
    .from("bill_votes")
    .select("vote")
    .eq("bill_id", billId)
    .eq("chamber", chamber);

  let yea = 0;
  let nay = 0;
  let abstain = 0;
  for (const v of votes ?? []) {
    if (v.vote === "yea") yea += 1;
    else if (v.vote === "nay") nay += 1;
    else if (v.vote === "abstain") abstain += 1;
  }
  const cast = (votes ?? []).length;
  return { yea, nay, abstain, cast };
}

function classifyFloorMajority(args: {
  yea: number;
  nay: number;
  cast: number;
  chamberSize: number;
  chamber: BillChamber;
}): "pass" | "fail" | "pending" | "vp_tie" {
  const { yea, nay, cast, chamberSize, chamber } = args;
  if (cast >= chamberSize) {
    if (yea > nay) return "pass";
    if (nay > yea) return "fail";
    return chamber === "senate" ? "vp_tie" : "fail";
  }
  const remaining = Math.max(0, chamberSize - cast);
  if (yea > nay + remaining) return "pass";
  if (nay > yea + remaining) return "fail";
  if (remaining === 0 && yea === nay) {
    return chamber === "senate" ? "vp_tie" : "fail";
  }
  return "pending";
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

/** After a successful floor vote: route to other chamber review or Oval. */
async function transitionAfterChamberPass(
  supabase: SupabaseClient,
  bill: { id: string; originating_chamber: string },
  floorChamber: BillChamber,
): Promise<void> {
  const orig = bill.originating_chamber as BillChamber;
  const nextOther = {
    status: "other_chamber_review" as const,
    chamber_vote_deadline_at: null,
    vp_tie_break_pending: false,
    leadership_deadline_at: hoursFromNowIso(OTHER_CHAMBER_REVIEW_HOURS),
  };
  const nextOval = { status: "oval" as const, chamber_vote_deadline_at: null, vp_tie_break_pending: false };

  const patch =
    floorChamber === "house"
      ? orig === "house"
        ? nextOther
        : nextOval
      : orig === "senate"
        ? nextOther
        : nextOval;

  const applied: Record<string, unknown> = { ...patch };
  let { error } = await supabase.from("bills").update(applied).eq("id", bill.id);
  if (error && isMissingBillTimerColumn(error.message)) {
    delete applied.leadership_deadline_at;
    const retry = await supabase.from("bills").update(applied).eq("id", bill.id);
    error = retry.error;
  }
  if (error && isMissingVpTieColumn(error.message)) {
    delete applied.vp_tie_break_pending;
    const retry = await supabase.from("bills").update(applied).eq("id", bill.id);
    error = retry.error;
  }
  if (error) throw new Error(error.message);
}

async function setBillFailed(supabase: SupabaseClient, billId: string, chamber: BillChamber): Promise<void> {
  await processVoteApproval(supabase, billId, chamber, false);
  let { error } = await supabase
    .from("bills")
    .update({ status: "failed", chamber_vote_deadline_at: null, vp_tie_break_pending: false })
    .eq("id", billId);
  if (error && isMissingVpTieColumn(error.message)) {
    const retry = await supabase
      .from("bills")
      .update({ status: "failed", chamber_vote_deadline_at: null })
      .eq("id", billId);
    error = retry.error;
  }
  if (error) console.warn("[setBillFailed]", billId, error.message);
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
    await setBillFailed(supabase, billId, "senate");
    return;
  }

  await processVoteApproval(supabase, billId, "senate", true);
  try {
    await transitionAfterChamberPass(supabase, bill, "senate");
  } catch (e) {
    console.warn("[resolveSenateAfterTiebreakVote] advance:", e);
  }
}

/** Advance bills whose chamber voting clocks have expired. */
export async function processBillDeadlines(supabase: SupabaseClient): Promise<void> {
  const { error: maintErr } = await supabase.rpc("legislation_run_maintenance");
  if (maintErr && !isMissingLegislationMaintenanceRpc(maintErr.message)) {
    console.warn("[processBillDeadlines] legislation_run_maintenance:", maintErr.message);
  }

  // Sweep active floor votes for immediate clinch transitions (all votes cast, irreversible margins, etc.)
  // so bills can advance without requiring an additional ballot event.
  const { data: liveFloorBills } = await supabase
    .from("bills")
    .select("id")
    .in("status", ["house_floor", "senate_floor"]);
  for (const row of liveFloorBills ?? []) {
    const billId = String((row as { id: string }).id);
    if (!billId) continue;
    await tryClinchFloorVoteAfterBallotChange(supabase, billId);
  }

  const nowIso = new Date().toISOString();

  const { data: houseFloor } = await supabase
    .from("bills")
    .select("id, originating_chamber")
    .eq("status", "house_floor")
    .not("chamber_vote_deadline_at", "is", null)
    .lt("chamber_vote_deadline_at", nowIso);

  for (const bill of houseFloor ?? []) {
    // Align with tryClinchFloorVoteAfterBallotChange: tallyChamberPass only compared raw yea vs nay and
    // ignored abstain/present and remaining electorate — wrong for partial tallies (e.g. Senate→House).
    const M = await countChamberVotingMembers(supabase, "house");
    if (M < 1) continue;
    const { yea, nay, cast } = await tallyFloorYeasNaysAbstain(supabase, bill.id, "house");
    const outcome = classifyFloorMajority({ yea, nay, cast, chamberSize: M, chamber: "house" });
    if (outcome === "pass") {
      await processVoteApproval(supabase, bill.id, "house", true);
      try {
        await transitionAfterChamberPass(supabase, bill, "house");
      } catch (e) {
        console.warn("[processBillDeadlines] house advance:", e);
      }
      continue;
    }
    await setBillFailed(supabase, bill.id, "house");
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
          await setBillFailed(supabase, bill.id, "senate");
          continue;
        }
        await processVoteApproval(supabase, bill.id, "senate", true);
        try {
          await transitionAfterChamberPass(supabase, bill, "senate");
        } catch (e) {
          console.warn("[processBillDeadlines] senate advance legacy:", e);
        }
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
      await processVoteApproval(supabase, bill.id, "senate", true);
      try {
        await transitionAfterChamberPass(supabase, bill, "senate");
      } catch (e) {
        console.warn("[processBillDeadlines] senate advance:", e);
      }
      continue;
    }
    if (nay > yea) {
      await setBillFailed(supabase, bill.id, "senate");
      continue;
    }

    let { error: tieErr } = await supabase
      .from("bills")
      .update({ vp_tie_break_pending: true, chamber_vote_deadline_at: null })
      .eq("id", bill.id);
    if (tieErr && isMissingVpTieColumn(tieErr.message)) {
      const retry = await supabase
        .from("bills")
        .update({ status: "failed", chamber_vote_deadline_at: null })
        .eq("id", bill.id);
      tieErr = retry.error;
    }
    if (tieErr) console.warn("[processBillDeadlines] senate tie:", tieErr.message);
  }
}

export async function tryClinchFloorVoteAfterBallotChange(
  supabase: SupabaseClient,
  billId: string,
): Promise<void> {
  const { data: bill } = await supabase
    .from("bills")
    .select("id, status, originating_chamber, chamber_vote_deadline_at, vp_tie_break_pending")
    .eq("id", billId)
    .maybeSingle();

  if (!bill) return;

  const deadlineIso = bill.chamber_vote_deadline_at as string | null;
  const deadlineMs = deadlineIso ? new Date(deadlineIso).getTime() : 0;
  const clockStillRunning = Boolean(deadlineIso) && deadlineMs > Date.now();

  if (bill.status === "house_floor") {
    if (!clockStillRunning) return;
    const M = await countChamberVotingMembers(supabase, "house");
    if (M < 1) return;
    const { yea, nay, cast } = await tallyFloorYeasNaysAbstain(supabase, billId, "house");
    const outcome = classifyFloorMajority({ yea, nay, cast, chamberSize: M, chamber: "house" });
    if (outcome === "pending") return;
    if (outcome === "fail" || outcome === "vp_tie") {
      await setBillFailed(supabase, billId, "house");
      return;
    }
    await processVoteApproval(supabase, billId, "house", true);
    try {
      await transitionAfterChamberPass(supabase, bill, "house");
    } catch (e) {
      console.warn("[tryClinchFloorVoteAfterBallotChange] house advance:", e);
    }
    return;
  }

  if (bill.status !== "senate_floor") return;
  if (bill.vp_tie_break_pending) return;

  const { data: pendingAppt } = await supabase
    .from("appointments")
    .select("id")
    .eq("confirmation_bill_id", billId)
    .eq("status", "pending")
    .maybeSingle();

  if (pendingAppt) {
    const electorate = await countSenateConfirmationElectorate(supabase);
    const { cast } = await tallyFloorYeasNaysAbstain(supabase, billId, "senate");
    if (electorate < 1 || cast < electorate) return;
    const { error: rpcErr } = await supabase.rpc("apply_appointment_confirmation", {
      p_bill_id: billId,
    });
    if (rpcErr) {
      console.warn(
        "[tryClinchFloorVoteAfterBallotChange] apply_appointment_confirmation:",
        billId,
        rpcErr.message,
      );
    }
    return;
  }

  if (!clockStillRunning) return;

  const M = await countChamberVotingMembers(supabase, "senate");
  if (M < 1) return;
  const { yea, nay, cast } = await tallyFloorYeasNaysAbstain(supabase, billId, "senate");
  const outcome = classifyFloorMajority({ yea, nay, cast, chamberSize: M, chamber: "senate" });
  if (outcome === "pending") return;

  if (outcome === "vp_tie") {
    let { error: tieErr } = await supabase
      .from("bills")
      .update({ vp_tie_break_pending: true, chamber_vote_deadline_at: null })
      .eq("id", billId);
    if (tieErr && isMissingVpTieColumn(tieErr.message)) {
      const retry = await supabase.from("bills").update({ status: "failed", chamber_vote_deadline_at: null }).eq("id", billId);
      tieErr = retry.error;
    }
    if (tieErr) console.warn("[tryClinchFloorVoteAfterBallotChange] senate tie:", tieErr.message);
    return;
  }

  if (outcome === "fail") {
    await setBillFailed(supabase, billId, "senate");
    return;
  }

  await processVoteApproval(supabase, billId, "senate", true);
  try {
    await transitionAfterChamberPass(supabase, bill, "senate");
  } catch (e) {
    console.warn("[tryClinchFloorVoteAfterBallotChange] advance:", e);
  }
}
