"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { addHours } from "date-fns";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { processBillDeadlines, resolveSenateAfterTiebreakVote } from "@/lib/bill-pipeline";
import { canFileFederalLegislation, originatingChamberForRoles } from "@/lib/legislative-eligibility";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import {
  isActivePresidentialRunningMate,
  userCanBreakSenateTie,
} from "@/lib/presidential-running-mate";
import { canAcceptRejectHopperForChamber, canActAsPresident } from "@/lib/role-capabilities";
import type { BillChamber } from "@/lib/bill-types";
import { POLITICAL_ROLE_LABELS } from "@/config/political-roles";
import { CABINET_APPOINTMENT_ROLE_KEY_SET } from "@/config/cabinet-appointment-roles";

function isMissingBillTimerColumn(message: string | undefined) {
  const m = (message ?? "").toLowerCase();
  return m.includes("leadership_deadline_at") || m.includes("chamber_vote_deadline_at");
}

function revalidateCongressPages() {
  revalidatePath("/congress");
  revalidatePath("/congress/house");
  revalidatePath("/congress/senate");
}

function revalidateCongressPagesAndLeadership() {
  revalidateCongressPages();
  revalidatePath("/congress/leadership");
}

function isMissingAppointmentGrantColumn(message: string | undefined) {
  const m = (message ?? "").toLowerCase();
  return m.includes("granted_role_key") || m.includes("schema cache");
}

async function assertFloorVoteOpen(supabase: SupabaseClient, bill_id: string, chamber: BillChamber) {
  const { data: b } = await supabase
    .from("bills")
    .select("status, vp_tie_break_pending, chamber_vote_deadline_at")
    .eq("id", bill_id)
    .maybeSingle();
  if (!b) throw new Error("Bill not found.");
  if (chamber === "house" && b.status !== "house_floor") {
    throw new Error("The House is not in a live floor vote on this bill.");
  }
  if (chamber === "senate" && b.status !== "senate_floor") {
    throw new Error("The Senate is not in a live floor vote on this bill.");
  }
  if (chamber === "house") {
    if (!b.chamber_vote_deadline_at || new Date(b.chamber_vote_deadline_at) < new Date()) {
      throw new Error("The House floor vote is closed.");
    }
  }
  if (chamber === "senate" && !b.vp_tie_break_pending) {
    if (!b.chamber_vote_deadline_at || new Date(b.chamber_vote_deadline_at) < new Date()) {
      throw new Error("The Senate floor vote is closed.");
    }
  }
}

export async function submitBill(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const title = String(formData.get("title") ?? "").trim();
  const content_md = String(formData.get("content_md") ?? "").trim();

  if (!title || !content_md) {
    throw new Error("Title and bill text are required.");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canFileFederalLegislation(roleKeys)) {
    throw new Error(
      "Only Representatives, Senators, or the President (or admin) may file legislation.",
    );
  }
  if (await isActivePresidentialRunningMate(supabase, user.id)) {
    throw new Error(
      "Presidential running mates (during the primary) may not file legislation in Congress.",
    );
  }

  const originating_chamber = originatingChamberForRoles(roleKeys);
  if (!originating_chamber) {
    throw new Error("Could not determine your chamber from your assigned roles.");
  }

  const now = new Date();
  const leadership_deadline_at = addHours(now, 12).toISOString();
  const expires_at = addHours(now, 24 * 30).toISOString();
  const duplicateCutoff = new Date(now.getTime() - 30_000).toISOString();

  const { data: recentDuplicate } = await supabase
    .from("bills")
    .select("id")
    .eq("author_id", user.id)
    .eq("title", title)
    .eq("content_md", content_md)
    .eq("originating_chamber", originating_chamber)
    .gte("created_at", duplicateCutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentDuplicate) {
    revalidateCongressPagesAndLeadership();
    return;
  }

  let { error } = await supabase.from("bills").insert({
    title,
    content_md,
    originating_chamber,
    author_id: user.id,
    expires_at,
    status: "hopper",
    leadership_deadline_at,
    chamber_vote_deadline_at: null,
  });

  if (error && isMissingBillTimerColumn(error.message)) {
    const retry = await supabase.from("bills").insert({
      title,
      content_md,
      originating_chamber,
      author_id: user.id,
      expires_at,
      status: "hopper",
    });
    error = retry.error;
  }

  if (error) throw new Error(error.message);
  await processBillDeadlines(supabase);
  revalidateCongressPagesAndLeadership();
  revalidatePath("/directory");
}

export async function leadershipReviewBill(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const bill_id = String(formData.get("bill_id"));
  const decision = String(formData.get("decision"));

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);

  if (await isActivePresidentialRunningMate(supabase, user.id)) {
    throw new Error("Presidential running mates may not move bills from leadership review.");
  }

  const { data: bill } = await supabase
    .from("bills")
    .select("id, status, originating_chamber")
    .eq("id", bill_id)
    .maybeSingle();

  if (!bill || bill.status !== "hopper") {
    throw new Error("This bill is not awaiting leadership review.");
  }

  const chamber = bill.originating_chamber as BillChamber;
  if (!canAcceptRejectHopperForChamber(roleKeys, chamber)) {
    throw new Error(
      chamber === "house"
        ? "Only the Speaker may accept or reject House legislation in the hopper."
        : "Only the Senate Majority Leader may accept or reject Senate legislation in the hopper.",
    );
  }

  if (decision === "reject") {
    let { error } = await supabase
      .from("bills")
      .update({ status: "dead", leadership_deadline_at: null, chamber_vote_deadline_at: null })
      .eq("id", bill_id);
    if (error && isMissingBillTimerColumn(error.message)) {
      const retry = await supabase.from("bills").update({ status: "dead" }).eq("id", bill_id);
      error = retry.error;
    }
    if (error) throw new Error(error.message);
  } else if (decision === "accept") {
    const floorStatus = chamber === "house" ? "house_floor" : "senate_floor";
    let { error } = await supabase
      .from("bills")
      .update({
        status: floorStatus,
        leadership_deadline_at: null,
        chamber_vote_deadline_at: addHours(new Date(), 24).toISOString(),
      })
      .eq("id", bill_id);
    if (error && isMissingBillTimerColumn(error.message)) {
      const retry = await supabase
        .from("bills")
        .update({ status: floorStatus })
        .eq("id", bill_id);
      error = retry.error;
    }
    if (error) throw new Error(error.message);
  } else {
    throw new Error("Invalid decision.");
  }

  await processBillDeadlines(supabase);
  revalidateCongressPagesAndLeadership();
  revalidatePath("/oval");
  revalidatePath("/directory");
}

export async function castBillVote(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const bill_id = String(formData.get("bill_id"));
  const chamber = String(formData.get("chamber")) as BillChamber;
  const vote = String(formData.get("vote"));

  const { data: billGate } = await supabase
    .from("bills")
    .select("vp_tie_break_pending")
    .eq("id", bill_id)
    .maybeSingle();

  await assertFloorVoteOpen(supabase, bill_id, chamber);

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);

  if (chamber === "house") {
    if (!roleKeys.includes("representative") && !roleKeys.includes("admin")) {
      throw new Error("Only Representatives may cast this vote.");
    }
  } else if (chamber === "senate") {
    if (billGate?.vp_tie_break_pending) {
      if (vote === "abstain") {
        throw new Error("Tie-breaking votes must be yea or nay.");
      }
      if (!(await userCanBreakSenateTie(supabase, user.id, roleKeys))) {
        throw new Error(
          "Only the Vice President or a presidential running mate (during the primary) may cast a tie-breaking Senate vote.",
        );
      }
    } else {
      if (!roleKeys.includes("senator") && !roleKeys.includes("admin")) {
        throw new Error("Only Senators may cast this vote.");
      }
      if (await isActivePresidentialRunningMate(supabase, user.id)) {
        throw new Error(
          "Presidential running mates may not vote on Senate floor bills except to break a tie.",
        );
      }
    }
  }

  await supabase
    .from("bill_votes")
    .delete()
    .eq("bill_id", bill_id)
    .eq("voter_id", user.id)
    .eq("chamber", chamber);

  const { error } = await supabase.from("bill_votes").insert({
    bill_id,
    voter_id: user.id,
    chamber,
    vote,
  });

  if (error) throw new Error(error.message);

  if (chamber === "senate" && billGate?.vp_tie_break_pending) {
    await resolveSenateAfterTiebreakVote(supabase, bill_id);
  }

  await processBillDeadlines(supabase);
  revalidateCongressPages();
  revalidatePath("/oval");
  revalidatePath("/directory");
}

export async function createAppointment(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canActAsPresident(roleKeys)) {
    throw new Error("Presidential authority required.");
  }
  if (await isActivePresidentialRunningMate(supabase, user.id)) {
    throw new Error("Presidential running mates may not create appointments.");
  }

  const rawDiscord = String(formData.get("nominee_discord") ?? "").trim();
  const nominee_discord = rawDiscord.replace(/\D/g, "") || rawDiscord;
  const kind = String(formData.get("kind") ?? "cabinet").trim();

  let title: string;
  let granted_role_key: string | null = null;
  if (kind === "cabinet") {
    const cabinetRole = String(formData.get("cabinet_role") ?? "").trim();
    if (!CABINET_APPOINTMENT_ROLE_KEY_SET.has(cabinetRole)) {
      throw new Error("Pick a cabinet position from the list.");
    }
    granted_role_key = cabinetRole;
    title = POLITICAL_ROLE_LABELS[cabinetRole] ?? cabinetRole;
  } else {
    title = String(formData.get("title") ?? "").trim();
    if (!title) {
      throw new Error("Office title is required for this appointment kind.");
    }
  }

  if (!nominee_discord) {
    throw new Error("Nominee Discord user id is required.");
  }

  const { data: nominee } = await supabase
    .from("profiles")
    .select("id, character_name, discord_username, discord_user_id")
    .eq("discord_user_id", nominee_discord)
    .maybeSingle();

  if (!nominee) {
    throw new Error(
      "No profile matches that Discord id. Check the number, or ask the nominee to log in once so their account is linked.",
    );
  }

  const nomineeLabel =
    nominee.character_name?.trim() ||
    nominee.discord_username?.trim() ||
    `User ${nominee.id.slice(0, 8)}…`;

  const content_md = [
    "## Presidential nomination (Senate confirmation)",
    "",
    `**Office:** ${title}`,
    `**Category:** ${kind}`,
    "",
    "### Nominee",
    "",
    `- **Character:** ${nomineeLabel}`,
    nominee.discord_username
      ? `- **Discord:** @${nominee.discord_username} (user id \`${nominee.discord_user_id}\`)`
      : `- **Discord user id:** \`${nominee.discord_user_id}\``,
    `- **Imperium user id:** \`${nominee.id}\``,
    "",
    "### Next step",
    "",
    "Senate leadership should **Accept** to send this to the Senate floor for a confirmation vote, or **Reject** to decline. If the leadership window expires with no action, the nomination is dropped.",
    "",
    "---",
    "",
    "_Submitted by the President._",
  ].join("\n");

  const now = new Date();
  const expires_at = addHours(now, 24 * 30).toISOString();
  const { data: bill, error: billError } = await supabase
    .from("bills")
    .insert({
      title: `Confirmation: ${title}`,
      content_md,
      originating_chamber: "senate",
      author_id: user.id,
      status: "hopper",
      expires_at,
      leadership_deadline_at: addHours(now, 12).toISOString(),
      chamber_vote_deadline_at: null,
    })
    .select("id")
    .single();

  if (billError || !bill) {
    throw new Error(billError?.message ?? "Unable to create confirmation bill.");
  }

  const baseAppt = {
    kind,
    title,
    nominee_user_id: nominee.id,
    president_user_id: user.id,
    confirmation_bill_id: bill.id,
  };

  let apptInsert = await supabase.from("appointments").insert(
    granted_role_key ? { ...baseAppt, granted_role_key } : baseAppt,
  );

  if (
    apptInsert.error &&
    granted_role_key &&
    isMissingAppointmentGrantColumn(apptInsert.error.message)
  ) {
    apptInsert = await supabase.from("appointments").insert(baseAppt);
  }

  if (apptInsert.error) throw new Error(apptInsert.error.message);
  revalidatePath("/oval");
  revalidateCongressPagesAndLeadership();
  revalidatePath("/directory");
}

export async function presidentialAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canActAsPresident(roleKeys)) {
    throw new Error("Presidential authority required.");
  }
  if (await isActivePresidentialRunningMate(supabase, user.id)) {
    throw new Error("Presidential running mates may not sign or veto legislation.");
  }

  const bill_id = String(formData.get("bill_id"));
  const action = String(formData.get("action"));

  const { data: bill } = await supabase.from("bills").select("status").eq("id", bill_id).maybeSingle();
  if (!bill || bill.status !== "oval") {
    throw new Error("Bill is not on the President’s desk.");
  }

  const next =
    action === "sign"
      ? { status: "law" as const, signed_at: new Date().toISOString() }
      : { status: "vetoed" as const, vetoed_at: new Date().toISOString() };

  const { error } = await supabase.from("bills").update(next).eq("id", bill_id);
  if (error) throw new Error(error.message);
  revalidatePath("/oval");
  revalidateCongressPages();
  revalidatePath("/directory");
}
