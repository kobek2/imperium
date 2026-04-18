"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { addHours } from "date-fns";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { processBillDeadlines } from "@/lib/bill-pipeline";
import { canFileFederalLegislation, originatingChamberForRoles } from "@/lib/legislative-eligibility";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { canActAsPresident, canReviewLeadershipForChamber } from "@/lib/role-capabilities";
import type { BillChamber } from "@/lib/bill-types";

function isMissingBillTimerColumn(message: string | undefined) {
  const m = (message ?? "").toLowerCase();
  return m.includes("leadership_deadline_at") || m.includes("chamber_vote_deadline_at");
}

async function assertFloorVoteOpen(supabase: SupabaseClient, bill_id: string, chamber: BillChamber) {
  const { data: b } = await supabase.from("bills").select("status").eq("id", bill_id).maybeSingle();
  if (!b) throw new Error("Bill not found.");
  if (chamber === "house" && b.status !== "house_floor") {
    throw new Error("The House is not in a live floor vote on this bill.");
  }
  if (chamber === "senate" && b.status !== "senate_floor") {
    throw new Error("The Senate is not in a live floor vote on this bill.");
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
    revalidatePath("/congress");
    revalidatePath("/congress/leadership");
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
  revalidatePath("/congress");
  revalidatePath("/congress/leadership");
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

  const { data: bill } = await supabase
    .from("bills")
    .select("id, status, originating_chamber")
    .eq("id", bill_id)
    .maybeSingle();

  if (!bill || bill.status !== "hopper") {
    throw new Error("This bill is not awaiting leadership review.");
  }

  const chamber = bill.originating_chamber as BillChamber;
  if (!canReviewLeadershipForChamber(roleKeys, chamber)) {
    throw new Error("You are not in the leadership roster for this chamber.");
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
  revalidatePath("/congress");
  revalidatePath("/congress/leadership");
  revalidatePath("/oval");
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

  await assertFloorVoteOpen(supabase, bill_id, chamber);

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
  await processBillDeadlines(supabase);
  revalidatePath("/congress");
  revalidatePath("/oval");
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

  const title = String(formData.get("title") ?? "").trim();
  const nominee_discord = String(formData.get("nominee_discord") ?? "").trim();
  const kind = String(formData.get("kind") ?? "cabinet");

  if (!title || !nominee_discord) {
    throw new Error("Title and nominee Discord ID are required.");
  }

  const { data: nominee } = await supabase
    .from("profiles")
    .select("id")
    .eq("discord_user_id", nominee_discord)
    .maybeSingle();

  if (!nominee) {
    throw new Error("Nominee must already have logged into the Command Center.");
  }

  const now = new Date();
  const expires_at = addHours(now, 24 * 30).toISOString();
  const { data: bill, error: billError } = await supabase
    .from("bills")
    .insert({
      title: `Confirmation: ${title}`,
      content_md: `Automatic confirmation message for **${title}**.\n\nNominee user id: \`${nominee.id}\``,
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

  const { error: apptError } = await supabase.from("appointments").insert({
    kind,
    title,
    nominee_user_id: nominee.id,
    president_user_id: user.id,
    confirmation_bill_id: bill.id,
  });

  if (apptError) throw new Error(apptError.message);
  revalidatePath("/oval");
  revalidatePath("/congress");
  revalidatePath("/congress/leadership");
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
  revalidatePath("/congress");
}
