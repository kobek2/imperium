"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { addHours } from "date-fns";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  processBillDeadlines,
  resolveSenateAfterTiebreakVote,
  tryClinchFloorVoteAfterBallotChange,
} from "@/lib/bill-pipeline";
import { canFileFederalLegislation, canFileLegislationInChamber } from "@/lib/legislative-eligibility";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import {
  isActivePresidentialRunningMate,
  userCanBreakSenateTie,
} from "@/lib/presidential-running-mate";
import {
  canAcceptRejectHopperForChamber,
  canActAsPresident,
  canLeadershipEditBillContent,
} from "@/lib/role-capabilities";
import {
  escapeHtmlPlain,
  htmlToPlainText,
  legacyMdToEditorHtml,
  sanitizeBillHtml,
} from "@/lib/sanitize-bill-html";
import type { BillChamber } from "@/lib/bill-types";
import { POLITICAL_ROLE_LABELS } from "@/config/political-roles";
import { CABINET_APPOINTMENT_ROLE_KEY_SET } from "@/config/cabinet-appointment-roles";
import { getIsAdmin } from "@/lib/is-admin";
import { isPresident } from "@/lib/president";
import { applyApprovalDelta } from "@/lib/approval-ratings";
import { dbErrorHintsMissingColumn } from "@/lib/db-error-hints";
import { receivingChamberForOrigination, leadershipEditChamberForBillStatus } from "@/lib/legislative-helpers";
import { throwIfPostgrestError } from "@/lib/supabase-error";

function revalidateCongressPages() {
  revalidatePath("/congress");
  revalidatePath("/congress/house");
  revalidatePath("/congress/senate");
}

function revalidateCongressPagesAndLeadership() {
  revalidateCongressPages();
  revalidatePath("/congress/leadership");
}

function revalidateBillPage(billId: string) {
  revalidatePath(`/bill/${billId}`);
}

function omitKeys<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const next = { ...obj };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

const FEDERAL_APPROPRIATIONS_TITLE_PREFIX = "Federal appropriations and revenue";

async function countPendingAmendments(supabase: SupabaseClient, billId: string): Promise<number> {
  const { count, error } = await supabase
    .from("bill_amendments")
    .select("id", { count: "exact", head: true })
    .eq("bill_id", billId)
    .eq("status", "pending");
  if (error) return 0;
  return count ?? 0;
}

function floorChamberForOpenVote(bill: { status: string; originating_chamber: BillChamber }): BillChamber {
  if (bill.status === "other_chamber_debate") {
    return receivingChamberForOrigination(bill.originating_chamber);
  }
  return bill.originating_chamber;
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
  const templateIdRaw = String(formData.get("template_id") ?? "").trim();
  const templateCoreMd = String(formData.get("template_core_md") ?? "").trim();
  const policyTagsJson = String(formData.get("policy_tags_json") ?? "").trim();
  const preambleRaw = String(formData.get("preamble_html") ?? "").trim();

  let content_html = "";
  if (templateIdRaw && templateCoreMd) {
    const preHtml = preambleRaw ? sanitizeBillHtml(preambleRaw) : "";
    const coreHtml = sanitizeBillHtml(
      legacyMdToEditorHtml(templateCoreMd) ?? `<pre>${escapeHtmlPlain(templateCoreMd)}</pre>`,
    );
    content_html = preHtml
      ? `${preHtml}<hr class="my-4 border-[var(--psc-border)]" />${coreHtml}`
      : coreHtml;
  } else {
    const rawHtml = String(formData.get("content_html") ?? "").trim();
    content_html = rawHtml ? sanitizeBillHtml(rawHtml) : "";
  }
  const content_md = htmlToPlainText(content_html);

  if (!title || !content_md) {
    throw new Error("Title and bill text are required.");
  }

  let policy_tags: Record<string, unknown> | null = null;
  let template_id: string | null = null;
  if (templateIdRaw) {
    const normalizedTemplateCore = templateCoreMd.replace(/\s+/g, " ").trim();
    if (!normalizedTemplateCore || !content_md.includes(normalizedTemplateCore)) {
      throw new Error(
        "Template bills must retain the full statutory text from the template (you may add a preamble above it).",
      );
    }
    if (policyTagsJson) {
      try {
        policy_tags = JSON.parse(policyTagsJson) as Record<string, unknown>;
      } catch {
        throw new Error("Invalid policy tags JSON.");
      }
    }
    template_id = templateIdRaw;
  }

  const presEarly = await isPresident(supabase, user.id);
  const adminEarly = await getIsAdmin();

  if (title.startsWith(FEDERAL_APPROPRIATIONS_TITLE_PREFIX)) {
    if (!presEarly && !adminEarly) {
      throw new Error("Only the President (or an admin) may use the federal appropriations bill title.");
    }
  }

  const federalAppropriationsFlag = String(formData.get("federal_appropriations") ?? "") === "1";
  if (federalAppropriationsFlag) {
    if (!presEarly && !adminEarly) {
      throw new Error("Invalid appropriations filing flag.");
    }
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

  const rawChamber = String(formData.get("originating_chamber") ?? "").trim();
  if (rawChamber !== "house" && rawChamber !== "senate") {
    throw new Error("Missing or invalid originating chamber.");
  }
  const originating_chamber = rawChamber as BillChamber;
  if (!canFileLegislationInChamber(roleKeys, originating_chamber)) {
    throw new Error(
      originating_chamber === "house"
        ? "You may not file House legislation with your current roles (Representatives, President, or admin)."
        : "You may not file Senate legislation with your current roles (Senators or admin).",
    );
  }

  const now = new Date();
  const leadership_deadline_at: string | null = null;
  const expires_at = addHours(now, 24 * 30).toISOString();
  const duplicateCutoff = new Date(now.getTime() - 30_000).toISOString();

  // Ensures the FY appropriations timer starts once the first President is seated.
  await supabase.rpc("fiscal_start_appropriation_clock_if_president_seated");

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

  const { data: activeFy } = await supabase
    .from("rp_fiscal_years")
    .select("id, appropriation_deadline_at, appropriations_act_bill_id")
    .eq("status", "active")
    .maybeSingle();

  const pres = presEarly;
  const admin = adminEarly;

  const wantsAppropriations =
    federalAppropriationsFlag || title.startsWith(FEDERAL_APPROPRIATIONS_TITLE_PREFIX);
  const needsAppropriationsGate =
    Boolean(activeFy?.id) && activeFy?.appropriations_act_bill_id == null;

  if (needsAppropriationsGate && wantsAppropriations) {
    if (!pres && !admin) {
      throw new Error(
        "Only the President (or an admin) may file the annual federal appropriations bill from the federal budget workspace.",
      );
    }
    if (originating_chamber !== "house") {
      throw new Error("The annual appropriations bill must originate in the House.");
    }
  }

  if (activeFy?.id && wantsAppropriations && originating_chamber === "house" && (pres || admin)) {
    if (activeFy.appropriations_act_bill_id) {
      throw new Error(
        "This fiscal year's appropriations act is already enrolled. Further appropriations bills for this year are locked.",
      );
    }
    const { data: pendingAppRows, error: pendErr } = await supabase
      .from("bills")
      .select("id, status")
      .eq("linked_fiscal_year_id", activeFy.id)
      .eq("is_federal_appropriations", true)
      .limit(40);
    if (pendErr) throw new Error(pendErr.message);
    const terminal = new Set(["dead", "vetoed", "failed"]);
    const hasOpenPipeline = (pendingAppRows ?? []).some(
      (r) => !terminal.has(String((r as { status?: string }).status ?? "")),
    );
    if (hasOpenPipeline) {
      throw new Error("An appropriations bill for this fiscal year is already in Congress or enrolled.");
    }
  }

  const isFederalAppropriationsBill =
    wantsAppropriations &&
    originating_chamber === "house" &&
    (pres || admin) &&
    Boolean(activeFy?.id);

  const appropriationExtras =
    isFederalAppropriationsBill && activeFy?.id
      ? { is_federal_appropriations: true as const, linked_fiscal_year_id: activeFy.id }
      : {};

  const templateExtras: Record<string, unknown> = {};
  if (template_id) templateExtras.template_id = template_id;
  if (policy_tags) templateExtras.policy_tags = policy_tags;

  const baseInsert = {
    title,
    content_md,
    content_html,
    originating_chamber,
    author_id: user.id,
    expires_at,
    status: "submitted" as const,
    leadership_deadline_at,
    chamber_vote_deadline_at: null as string | null,
    ...appropriationExtras,
    ...templateExtras,
  };

  let { error } = await supabase.from("bills").insert(baseInsert);

  if (error && dbErrorHintsMissingColumn(error.message, [
    "leadership_deadline_at",
    "chamber_vote_deadline_at",
  ])) {
    const minimal = omitKeys(baseInsert, ["leadership_deadline_at", "chamber_vote_deadline_at"]);
    const retry = await supabase.from("bills").insert(minimal);
    error = retry.error;
  }

  if (error && dbErrorHintsMissingColumn(error.message, ["content_html", "schema cache"])) {
    const retry = await supabase.from("bills").insert({
      title,
      content_md,
      originating_chamber,
      author_id: user.id,
      expires_at,
      status: "submitted",
      leadership_deadline_at,
      chamber_vote_deadline_at: null,
      ...appropriationExtras,
    });
    error = retry.error;
    if (error && dbErrorHintsMissingColumn(error.message, [
    "leadership_deadline_at",
    "chamber_vote_deadline_at",
  ])) {
      const retry2 = await supabase.from("bills").insert({
        title,
        content_md,
        originating_chamber,
        author_id: user.id,
        expires_at,
        status: "submitted",
        ...appropriationExtras,
      });
      error = retry2.error;
    }
  }

  if (error && dbErrorHintsMissingColumn(error.message, ["is_federal_appropriations", "linked_fiscal_year_id"])) {
    const withoutApp = omitKeys(baseInsert, ["is_federal_appropriations", "linked_fiscal_year_id"]);
    const retry = await supabase.from("bills").insert(withoutApp);
    error = retry.error;
  }

  if (error && dbErrorHintsMissingColumn(error.message, ["template_id", "policy_tags"])) {
    const withoutTpl = { ...baseInsert } as Record<string, unknown>;
    delete withoutTpl.template_id;
    delete withoutTpl.policy_tags;
    const retry = await supabase.from("bills").insert(withoutTpl);
    error = retry.error;
  }

  throwIfPostgrestError(error);
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
  const isAdminActor = roleKeys.includes("admin");

  if (!isAdminActor && (await isActivePresidentialRunningMate(supabase, user.id))) {
    throw new Error("Presidential running mates may not move bills from leadership review.");
  }

  const { data: bill } = await supabase
    .from("bills")
    .select("id, status, originating_chamber")
    .eq("id", bill_id)
    .maybeSingle();

  if (!bill || bill.status !== "submitted") {
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
    if (error && dbErrorHintsMissingColumn(error.message, [
    "leadership_deadline_at",
    "chamber_vote_deadline_at",
  ])) {
      const retry = await supabase.from("bills").update({ status: "dead" }).eq("id", bill_id);
      error = retry.error;
    }
    throwIfPostgrestError(error);
  } else if (decision === "accept") {
    const nowIso = new Date().toISOString();
    let { error } = await supabase
      .from("bills")
      .update({
        status: "debate",
        leadership_deadline_at: null,
        chamber_vote_deadline_at: null,
        vp_tie_break_pending: false,
        debate_started_at: nowIso,
      })
      .eq("id", bill_id);
    if (error && dbErrorHintsMissingColumn(error.message, ["debate_started_at"])) {
      const retry = await supabase
        .from("bills")
        .update({
          status: "debate",
          leadership_deadline_at: null,
          chamber_vote_deadline_at: null,
          vp_tie_break_pending: false,
        })
        .eq("id", bill_id);
      error = retry.error;
    }
    if (error) {
      const legacy = await supabase
        .from("bills")
        .update({
          status: "on_docket",
          leadership_deadline_at: null,
          chamber_vote_deadline_at: null,
          vp_tie_break_pending: false,
        })
        .eq("id", bill_id);
      error = legacy.error;
    }
    if (error && dbErrorHintsMissingColumn(error.message, [
    "leadership_deadline_at",
    "chamber_vote_deadline_at",
  ])) {
      const retry = await supabase.from("bills").update({ status: "on_docket" }).eq("id", bill_id);
      error = retry.error;
    }
    if (error && dbErrorHintsMissingColumn(error.message, ["vp_tie_break_pending"])) {
      const retry = await supabase
        .from("bills")
        .update({
          status: "on_docket",
          leadership_deadline_at: null,
          chamber_vote_deadline_at: null,
        })
        .eq("id", bill_id);
      error = retry.error;
    }
    throwIfPostgrestError(error);
  } else {
    throw new Error("Invalid decision.");
  }

  await processBillDeadlines(supabase);
  revalidateCongressPagesAndLeadership();
  revalidatePath("/oval");
  revalidatePath("/directory");
  revalidateBillPage(bill_id);
}

/** Move a bill from the leadership docket to an active floor vote with a chosen duration. */
export async function leadershipOpenFloorVote(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const bill_id = String(formData.get("bill_id"));
  const preset = String(formData.get("duration_preset") ?? "24").trim();
  const customRaw = String(formData.get("duration_custom_hours") ?? "").trim();
  const adminCloseNow = String(formData.get("admin_close_now") ?? "") === "1";

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const isAdminActor = roleKeys.includes("admin");

  if (!isAdminActor && (await isActivePresidentialRunningMate(supabase, user.id))) {
    throw new Error("Presidential running mates may not open floor votes.");
  }

  const { data: bill } = await supabase
    .from("bills")
    .select("id, status, originating_chamber")
    .eq("id", bill_id)
    .maybeSingle();

  if (!bill || !["on_docket", "debate", "other_chamber_debate"].includes(String(bill.status))) {
    throw new Error("This bill is not ready for a floor vote (docket or debate phase).");
  }

  const nPending = await countPendingAmendments(supabase, bill_id);
  if (nPending > 0) {
    throw new Error("Resolve or table every pending amendment before opening a floor vote.");
  }

  const floorChamber = floorChamberForOpenVote(bill as { status: string; originating_chamber: BillChamber });
  if (!canAcceptRejectHopperForChamber(roleKeys, floorChamber)) {
    throw new Error(
      floorChamber === "house"
        ? "Only the Speaker may open this House floor vote."
        : "Only the Senate Majority Leader may open this Senate floor vote.",
    );
  }

  const fixedDebate = bill.status === "debate" || bill.status === "other_chamber_debate";
  let hours = fixedDebate ? 24 : preset === "custom" ? Number(customRaw) : Number(preset);
  if (!Number.isFinite(hours) || hours < 1) hours = 24;
  if (!fixedDebate && hours > 336) hours = 336;
  const voteDeadlineIso =
    isAdminActor && adminCloseNow
      ? new Date(Date.now() - 1_000).toISOString()
      : addHours(new Date(), hours).toISOString();

  const floorStatus = floorChamber === "house" ? "house_floor" : "senate_floor";
  let { error } = await supabase
    .from("bills")
    .update({
      status: floorStatus,
      leadership_deadline_at: null,
      chamber_vote_deadline_at: voteDeadlineIso,
      vp_tie_break_pending: false,
    })
    .eq("id", bill_id);

  if (error && dbErrorHintsMissingColumn(error.message, [
    "leadership_deadline_at",
    "chamber_vote_deadline_at",
  ])) {
    const retry = await supabase.from("bills").update({ status: floorStatus }).eq("id", bill_id);
    error = retry.error;
  }
  if (error && dbErrorHintsMissingColumn(error.message, ["vp_tie_break_pending"])) {
    const retry = await supabase
      .from("bills")
      .update({
        status: floorStatus,
        chamber_vote_deadline_at: voteDeadlineIso,
      })
      .eq("id", bill_id);
    error = retry.error;
  }
  throwIfPostgrestError(error);

  await processBillDeadlines(supabase);
  revalidateCongressPagesAndLeadership();
  revalidatePath("/oval");
  revalidatePath("/directory");
  revalidateBillPage(bill_id);
}

export async function updateBillContent(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const bill_id = String(formData.get("bill_id"));
  const rawHtml = String(formData.get("content_html") ?? "");
  const content_html = rawHtml ? sanitizeBillHtml(rawHtml) : "";
  const content_md = htmlToPlainText(content_html);

  if (!content_md) {
    throw new Error("Bill text is required.");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);

  if (await isActivePresidentialRunningMate(supabase, user.id)) {
    throw new Error("Presidential running mates may not edit bills.");
  }

  const { data: bill } = await supabase
    .from("bills")
    .select("id, originating_chamber, content_html, content_md, status")
    .eq("id", bill_id)
    .maybeSingle();

  if (!bill) throw new Error("Bill not found.");

  const editChamber = leadershipEditChamberForBillStatus(
    String(bill.status),
    bill.originating_chamber as BillChamber,
  );
  if (!editChamber || !canLeadershipEditBillContent(roleKeys, editChamber)) {
    throw new Error("Only the Speaker or Senate Majority Leader may edit this bill during the current debate phase.");
  }

  const terminal = new Set(["law", "vetoed", "dead", "failed"]);
  if (terminal.has(bill.status)) {
    throw new Error("This bill can no longer be edited.");
  }

  const previousHtml = (bill as { content_html?: string | null }).content_html?.trim();
  const previousMd = (bill as { content_md?: string | null }).content_md?.trim();
  const snapshot =
    previousHtml && previousHtml.length > 0
      ? previousHtml
      : `<pre>${escapeHtmlPlain(previousMd ?? "")}</pre>`;

  if (snapshot !== content_html) {
    const { error: verErr } = await supabase.from("bill_versions").insert({
      bill_id,
      content_html: snapshot,
      edited_by: user.id,
    });
    if (verErr && !verErr.message?.includes("bill_versions") && verErr.code !== "PGRST205") {
      console.warn("[updateBillContent] version insert:", verErr.message);
    }
  }

  let { error } = await supabase
    .from("bills")
    .update({ content_html, content_md })
    .eq("id", bill_id);

  if (error && dbErrorHintsMissingColumn(error.message, ["content_html", "schema cache"])) {
    const retry = await supabase.from("bills").update({ content_md }).eq("id", bill_id);
    error = retry.error;
  }
  throwIfPostgrestError(error);

  await processBillDeadlines(supabase);
  revalidateCongressPagesAndLeadership();
  revalidatePath("/oval");
  revalidatePath("/directory");
  revalidateBillPage(bill_id);
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

  const allowed = billGate?.vp_tie_break_pending ? ["yea", "nay"] : ["yea", "nay", "abstain", "present"];
  if (!allowed.includes(vote)) {
    throw new Error("Invalid vote.");
  }

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

  throwIfPostgrestError(error);

  if (chamber === "senate" && billGate?.vp_tie_break_pending) {
    await resolveSenateAfterTiebreakVote(supabase, bill_id);
  }

  await tryClinchFloorVoteAfterBallotChange(supabase, bill_id);
  await processBillDeadlines(supabase);
  revalidateCongressPagesAndLeadership();
  revalidatePath("/oval");
  revalidatePath("/directory");
  revalidateBillPage(bill_id);
}

/** Receiving chamber leadership accepts or rejects a bill after the first chamber passed. */
export async function otherChamberLeadershipReviewBill(formData: FormData): Promise<void> {
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
  const isAdminActor = roleKeys.includes("admin");

  if (!isAdminActor && (await isActivePresidentialRunningMate(supabase, user.id))) {
    throw new Error("Presidential running mates may not review bills for the other chamber.");
  }

  const { data: bill } = await supabase
    .from("bills")
    .select("id, status, originating_chamber")
    .eq("id", bill_id)
    .maybeSingle();

  if (!bill || bill.status !== "other_chamber_review") {
    throw new Error("This bill is not awaiting the other chamber’s leadership review.");
  }

  const receiving = receivingChamberForOrigination(bill.originating_chamber as BillChamber);
  if (!canAcceptRejectHopperForChamber(roleKeys, receiving)) {
    throw new Error(
      receiving === "house"
        ? "Only the Speaker may accept or reject bills for the House at this stage."
        : "Only the Senate Majority Leader may accept or reject bills for the Senate at this stage.",
    );
  }

  const nowIso = new Date().toISOString();
  if (decision === "reject") {
    let { error } = await supabase
      .from("bills")
      .update({
        status: "failed",
        leadership_deadline_at: null,
        chamber_vote_deadline_at: null,
        vp_tie_break_pending: false,
      })
      .eq("id", bill_id);
    if (error && dbErrorHintsMissingColumn(error.message, ["vp_tie_break_pending"])) {
      const retry = await supabase
        .from("bills")
        .update({ status: "failed", leadership_deadline_at: null, chamber_vote_deadline_at: null })
        .eq("id", bill_id);
      error = retry.error;
    }
    if (error && error.message.toLowerCase().includes("failed")) {
      const retry = await supabase
        .from("bills")
        .update({ status: "dead", leadership_deadline_at: null, chamber_vote_deadline_at: null })
        .eq("id", bill_id);
      error = retry.error;
    }
    throwIfPostgrestError(error);
  } else if (decision === "accept") {
    let { error } = await supabase
      .from("bills")
      .update({
        status: "other_chamber_debate",
        leadership_deadline_at: null,
        chamber_vote_deadline_at: null,
        vp_tie_break_pending: false,
        debate_started_at: nowIso,
      })
      .eq("id", bill_id);
    if (error && dbErrorHintsMissingColumn(error.message, ["debate_started_at", "other_chamber"])) {
      const retry = await supabase
        .from("bills")
        .update({
          status: "other_chamber_debate",
          leadership_deadline_at: null,
          chamber_vote_deadline_at: null,
          vp_tie_break_pending: false,
        })
        .eq("id", bill_id);
      error = retry.error;
    }
    if (error) {
      const legacy = await supabase
        .from("bills")
        .update({
          status: "on_docket",
          leadership_deadline_at: null,
          chamber_vote_deadline_at: null,
          vp_tie_break_pending: false,
        })
        .eq("id", bill_id);
      error = legacy.error;
    }
    throwIfPostgrestError(error);
  } else {
    throw new Error("Invalid decision.");
  }

  await processBillDeadlines(supabase);
  revalidateCongressPagesAndLeadership();
  revalidatePath("/oval");
  revalidatePath("/directory");
  revalidateBillPage(bill_id);
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

  await supabase.rpc("fiscal_start_appropriation_clock_if_president_seated");

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
    "Senate leadership should **Accept** to send this to the Senate floor for a confirmation vote, or **Reject** to decline.",
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
      status: "submitted",
      expires_at,
      leadership_deadline_at: null,
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
    dbErrorHintsMissingColumn(apptInsert.error.message, ["granted_role_key", "schema cache"])
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
  throwIfPostgrestError(error);

  if (action === "sign") {
    const { data: signed } = await supabase
      .from("bills")
      .select("is_federal_appropriations, policy_tags, author_id")
      .eq("id", bill_id)
      .maybeSingle();
    const s = signed as { is_federal_appropriations?: boolean; policy_tags?: unknown; author_id?: string } | null;
    if (s?.policy_tags) {
      const { error: polErr } = await supabase.rpc("policy_status_apply_signed_bill", { p_bill_id: bill_id });
      if (polErr) console.warn("[presidentialAction] policy_status_apply_signed_bill:", polErr.message);
    }
    if (s?.author_id) {
      await applyApprovalDelta(supabase, s.author_id, 5, "Authored a bill signed into law");
    }
    if (s?.is_federal_appropriations) {
      const { error: enrollErr } = await supabase.rpc("fiscal_on_appropriations_enrolled", {
        p_bill_id: bill_id,
      });
      if (enrollErr) throw new Error(enrollErr.message);
    }
  }

  revalidatePath("/oval");
  revalidateCongressPages();
  revalidatePath("/directory");
  revalidateBillPage(bill_id);
}
