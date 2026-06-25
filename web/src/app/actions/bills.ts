"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { addHours } from "date-fns";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  finalizeFloorVoteByCastYeaNayPlurality,
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
import { applyApprovalDelta, processYearEndParticipationApproval } from "@/lib/approval-ratings";
import { dbErrorHintsMissingColumn } from "@/lib/db-error-hints";
import { receivingChamberForOrigination, leadershipEditChamberForBillStatus } from "@/lib/legislative-helpers";
import { throwIfPostgrestError } from "@/lib/supabase-error";
import { generateCrisisFollowUpForArc } from "@/lib/crisis-followup";
import {
  DEBATE_AUTO_FLOOR_HOURS,
  HOPPER_LEADERSHIP_HOURS,
  ON_DOCKET_AUTO_FLOOR_HOURS,
  hoursFromNowIso,
} from "@/lib/legislation-automation-constants";
import {
  canBypassChangePolicyBillLimit,
  countChangePolicyBillsInCongress,
  policyCongressOrdinalLabel,
  resolvePolicyCongressCycleStartYear,
} from "@/lib/policy-congress-cycle";
import {
  defaultStockEffectFromPolicyTags,
  parseStockMarketEffect,
  sectorFromIssueKey,
  SECTOR_BILL_MEASURES,
} from "@/lib/legislation-stock";
import { BUSINESS_SECTORS } from "@/lib/economy-config";

function revalidateCongressPages() {
  revalidatePath("/congress");
  revalidatePath("/congress/house");
  revalidatePath("/congress/senate");
  revalidatePath("/economy/stocks/market-events");
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
  let content_md = "";
  if (templateIdRaw && templateCoreMd) {
    const preHtml = preambleRaw ? sanitizeBillHtml(preambleRaw) : "";
    const coreHtml = sanitizeBillHtml(
      legacyMdToEditorHtml(templateCoreMd) ?? `<pre>${escapeHtmlPlain(templateCoreMd)}</pre>`,
    );
    content_html = preHtml
      ? `${preHtml}<hr class="my-4 border-[var(--psc-border)]" />${coreHtml}`
      : coreHtml;
    content_md = htmlToPlainText(content_html);
  } else {
    const rawHtml = String(formData.get("content_html") ?? "").trim();
    const rawMd = String(formData.get("content_md") ?? "").trim();
    if (rawHtml) {
      content_html = sanitizeBillHtml(rawHtml);
      content_md = htmlToPlainText(content_html);
    } else if (rawMd) {
      content_md = rawMd;
      content_html = sanitizeBillHtml(legacyMdToEditorHtml(rawMd) ?? `<pre>${escapeHtmlPlain(rawMd)}</pre>`);
    }
  }

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

  const federalAppropriationsFlag = String(formData.get("federal_appropriations") ?? "") === "1";
  const wantsAppropriations =
    federalAppropriationsFlag || title.startsWith(FEDERAL_APPROPRIATIONS_TITLE_PREFIX);
  if (wantsAppropriations) {
    throw new Error("Federal appropriations bills are disabled in baseline mode.");
  }

  const rawChamber = String(formData.get("originating_chamber") ?? "").trim();
  if (rawChamber !== "house" && rawChamber !== "senate") {
    throw new Error("Missing or invalid originating chamber.");
  }
  const originating_chamber = rawChamber as BillChamber;

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

  if (!canFileLegislationInChamber(roleKeys, originating_chamber)) {
    throw new Error(
      originating_chamber === "house"
        ? "You may not file House legislation with your current roles (Representatives, President, or admin)."
        : "You may not file Senate legislation with your current roles (Senators or admin).",
    );
  }

  const now = new Date();
  const floorVoteHours = 24;
  const chamber_vote_deadline_at = addHours(now, floorVoteHours).toISOString();
  const floorStatus = originating_chamber === "house" ? "house_floor" : "senate_floor";
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
    revalidateCongressPages();
    return;
  }

  const templateExtras: Record<string, unknown> = {};
  if (template_id) templateExtras.template_id = template_id;
  if (policy_tags) templateExtras.policy_tags = policy_tags;

  let policy_congress_cycle_start_year: number | null = null;
  if (template_id) {
    const cycleStart = await resolvePolicyCongressCycleStartYear(supabase, {
      isAdminForHeal: roleKeys.includes("admin"),
    });
    if (!canBypassChangePolicyBillLimit(roleKeys)) {
      const used = await countChangePolicyBillsInCongress(supabase, user.id, cycleStart);
      if (used >= 1) {
        throw new Error(
          `You may only file one Change Policy (preset issue) bill per two-year congressional term. You already used your filing for the ${policyCongressOrdinalLabel(cycleStart)}.`,
        );
      }
    }
    policy_congress_cycle_start_year = cycleStart;
  }

  const policyCongressExtras: Record<string, unknown> = {};
  if (policy_congress_cycle_start_year != null) {
    policyCongressExtras.policy_congress_cycle_start_year = policy_congress_cycle_start_year;
  }

  const sectorKeys = new Set(BUSINESS_SECTORS.map((s) => s.key));
  const affectedSectorRaw = String(formData.get("affected_sector") ?? "").trim();
  let affected_sector: string | null = sectorKeys.has(affectedSectorRaw as (typeof BUSINESS_SECTORS)[number]["key"])
    ? affectedSectorRaw
    : null;
  let stock_market_effect = parseStockMarketEffect(String(formData.get("stock_market_effect") ?? ""));

  if (!affected_sector && policy_tags) {
    affected_sector = sectorFromIssueKey(String(policy_tags.issue_key ?? ""));
  }
  if (stock_market_effect === null && policy_tags && affected_sector) {
    stock_market_effect = defaultStockEffectFromPolicyTags(policy_tags);
  }

  const filingKind = String(formData.get("filing_kind") ?? "custom").trim();
  const lobbyOfferIdRaw = String(formData.get("lobby_offer_id") ?? "").trim();
  const sectorFilingExtras: Record<string, unknown> = {};

  if (filingKind === "company_sector") {
    sectorFilingExtras.filing_kind = "company_sector";
    if (lobbyOfferIdRaw) {
      const { data: offer } = await supabase
        .from("company_lobby_offers")
        .select(
          "id, recipient_user_id, status, affected_sector, stock_market_effect, bill_title, bill_content_md",
        )
        .eq("id", lobbyOfferIdRaw)
        .maybeSingle();
      if (!offer) throw new Error("Lobby offer not found.");
      if (offer.recipient_user_id !== user.id) {
        throw new Error("This lobby offer is not addressed to you.");
      }
      if (offer.status !== "funded") {
        throw new Error("This lobby offer is no longer available for filing.");
      }
      if (title !== String(offer.bill_title).trim()) {
        throw new Error("Company sector bills must use the lobby offer title unchanged.");
      }
      affected_sector = String(offer.affected_sector);
      stock_market_effect = Number(offer.stock_market_effect);
      sectorFilingExtras.lobby_offer_id = lobbyOfferIdRaw;
    } else {
      const companyId = String(formData.get("company_id") ?? "").trim();
      const measureKey = String(formData.get("measure_key") ?? "").trim();
      if (!companyId) throw new Error("Select a company for sector legislation.");
      const { data: biz } = await supabase
        .from("businesses")
        .select("id, owner_user_id, sector, name, ticker_symbol")
        .eq("id", companyId)
        .maybeSingle();
      if (!biz) throw new Error("Company not found.");
      if (biz.owner_user_id !== user.id) {
        throw new Error("Only the company founder may file founder-initiated sector bills.");
      }
      if (!affected_sector) affected_sector = String(biz.sector);
      if (affected_sector !== String(biz.sector)) {
        throw new Error("Affected sector must match your company's industry.");
      }
      if (stock_market_effect === null) {
        const measure = SECTOR_BILL_MEASURES.find((m) => m.key === measureKey);
        if (!measure) throw new Error("Select a sector legislation type.");
        stock_market_effect = measure.stockEffect;
      }
    }
    if (!affected_sector) {
      throw new Error("Company sector bills must specify an affected sector.");
    }
    if (stock_market_effect === null || stock_market_effect === 0) {
      throw new Error("Company sector bills must specify a non-zero stock market effect.");
    }
  } else if (template_id) {
    sectorFilingExtras.filing_kind = "policy";
  }

  const economicExtras: Record<string, unknown> = {};
  if (affected_sector) {
    economicExtras.affected_sector = affected_sector;
    economicExtras.sector_tag = affected_sector;
    if (stock_market_effect !== null) {
      economicExtras.stock_market_effect = stock_market_effect;
    }
  }

  const crisisArcRaw = String(formData.get("crisis_story_arc_id") ?? "").trim();
  const crisisExtras: Record<string, unknown> = {};
  if (crisisArcRaw) {
    crisisExtras.crisis_story_arc_id = crisisArcRaw;
  }

  const baseInsert = {
    title,
    content_md,
    content_html,
    originating_chamber,
    author_id: user.id,
    expires_at,
    status: floorStatus as "house_floor" | "senate_floor",
    leadership_deadline_at: null as string | null,
    chamber_vote_deadline_at,
    ...templateExtras,
    ...policyCongressExtras,
    ...economicExtras,
    ...sectorFilingExtras,
    ...crisisExtras,
  };

  let { error } = await supabase.from("bills").insert(baseInsert);

  if (error && dbErrorHintsMissingColumn(error.message, ["filing_kind", "lobby_offer_id"])) {
    const withoutSectorMeta = { ...baseInsert } as Record<string, unknown>;
    delete withoutSectorMeta.filing_kind;
    delete withoutSectorMeta.lobby_offer_id;
    const retry = await supabase.from("bills").insert(withoutSectorMeta);
    error = retry.error;
  }

  if (
    error &&
    dbErrorHintsMissingColumn(error.message, [
      "leadership_review",
      "leadership_primary_deadline",
      "leadership_deputy_deadline",
      "leadership_review_opened_at",
    ])
  ) {
    const retry = await supabase.from("bills").insert({
      title,
      content_md,
      content_html,
      originating_chamber,
      author_id: user.id,
      expires_at,
      status: floorStatus,
      chamber_vote_deadline_at,
      ...templateExtras,
    });
    error = retry.error;
  }

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
      status: floorStatus,
      chamber_vote_deadline_at,
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
        status: floorStatus,
      });
      error = retry2.error;
    }
  }

  if (error && dbErrorHintsMissingColumn(error.message, ["template_id", "policy_tags"])) {
    const withoutTpl = { ...baseInsert } as Record<string, unknown>;
    delete withoutTpl.template_id;
    delete withoutTpl.policy_tags;
    const retry = await supabase.from("bills").insert(withoutTpl);
    error = retry.error;
  }

  if (error && dbErrorHintsMissingColumn(error.message, ["policy_congress_cycle_start_year"])) {
    const withoutPolicy = { ...baseInsert } as Record<string, unknown>;
    delete withoutPolicy.policy_congress_cycle_start_year;
    const retry = await supabase.from("bills").insert(withoutPolicy);
    error = retry.error;
  }

  if (error && dbErrorHintsMissingColumn(error.message, ["crisis_story_arc_id"])) {
    const withoutCrisis = { ...baseInsert } as Record<string, unknown>;
    delete withoutCrisis.crisis_story_arc_id;
    const retry = await supabase.from("bills").insert(withoutCrisis);
    error = retry.error;
  }

  throwIfPostgrestError(error);

  if (crisisArcRaw) {
    try {
      await generateCrisisFollowUpForArc(supabase, crisisArcRaw);
    } catch (followUpErr) {
      console.warn("[submitBill] crisis follow-up generation failed", followUpErr);
    }
    revalidatePath("/events");
  }

  if (filingKind === "company_sector" && lobbyOfferIdRaw) {
    const { data: newest } = await supabase
      .from("bills")
      .select("id")
      .eq("author_id", user.id)
      .eq("title", title)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (newest?.id) {
      const { error: lobbyErr } = await supabase.rpc("complete_company_lobby_filing", {
        p_offer_id: lobbyOfferIdRaw,
        p_bill_id: newest.id,
      });
      if (lobbyErr) throw new Error(lobbyErr.message);
    }
  }

  await processBillDeadlines(supabase);
  revalidateCongressPages();
  revalidatePath("/directory");
}

export async function leadershipReviewBill(formData: FormData): Promise<void> {
  void formData;
  throw new Error("Hopper leadership review is disabled in baseline mode. Bills go straight to floor voting.");
}

/** Move a bill from the leadership docket to an active floor vote with a chosen duration. */
export async function leadershipOpenFloorVote(formData: FormData): Promise<void> {
  void formData;
  throw new Error("Hopper docket actions are disabled in baseline mode. Bills open floor voting automatically.");
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
    throw new Error(
      "Only the Speaker, House Deputy, Senate Majority Leader, or Senate Deputy may edit this bill during the current leadership-edit phase.",
    );
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

  const { data: existingVote } = await supabase
    .from("bill_votes")
    .select("vote")
    .eq("bill_id", bill_id)
    .eq("voter_id", user.id)
    .eq("chamber", chamber)
    .maybeSingle();

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

  const priorVote = String((existingVote as { vote?: string } | null)?.vote ?? "").toLowerCase();
  if (priorVote && priorVote !== vote.toLowerCase()) {
    await applyApprovalDelta(
      supabase,
      user.id,
      -1,
      `Changed a floor vote on ${chamber === "house" ? "House" : "Senate"} legislation`,
    );
  }

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
  void formData;
  throw new Error("Other-chamber hopper review is disabled in baseline mode. Bills route directly to floor voting.");
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

  const nomineeUserId = String(formData.get("nominee_user_id") ?? "").trim();
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

  if (!nomineeUserId && !nominee_discord) {
    throw new Error("Nominee is required.");
  }

  const nomineeQuery = supabase
    .from("profiles")
    .select("id, character_name, discord_username, discord_user_id");
  const { data: nominee } = nomineeUserId
    ? await nomineeQuery.eq("id", nomineeUserId).maybeSingle()
    : await nomineeQuery.eq("discord_user_id", nominee_discord).maybeSingle();

  if (!nominee) {
    throw new Error(
      "No matching profile found for the selected nominee.",
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
      leadership_deadline_at: hoursFromNowIso(HOPPER_LEADERSHIP_HOURS),
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

  const { data: bill } = await supabase
    .from("bills")
    .select("status, crisis_story_arc_id")
    .eq("id", bill_id)
    .maybeSingle();
  if (!bill || bill.status !== "oval") {
    throw new Error("Bill is not on the President’s desk.");
  }

  const crisisArcId = String(bill.crisis_story_arc_id ?? "").trim() || null;

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
      // Enrollment + optional FY rollover run in DB via trigger `trg_fiscal_sync_enacted_appropriations_floor`
      // (`fiscal_on_appropriations_enrolled`) when the bill row becomes `law`.
      const yearEnd = await processYearEndParticipationApproval(supabase);
      if (yearEnd.adjustedMembers > 0) {
        console.info(
          `[presidentialAction] Year-end participation approval adjusted ${yearEnd.adjustedMembers} member(s) after appropriations signed.`,
        );
      }
      revalidatePath("/economy");
      revalidatePath("/economy/federal");
      revalidatePath("/admin/economy/overview");
      revalidatePath("/cabinet/treasury");
      // TODO: Discord webhook — appropriations signed / FY rolled #announcements
    }
    if (crisisArcId) {
      try {
        await generateCrisisFollowUpForArc(supabase, crisisArcId);
      } catch (followUpErr) {
        console.warn("[presidentialAction] crisis follow-up generation failed", followUpErr);
      }
      revalidatePath("/events");
    }
  }

  revalidatePath("/oval");
  revalidateCongressPages();
  revalidatePath("/directory");
  revalidateBillPage(bill_id);
}

/** Expire the chamber floor vote clock now and run the pipeline (same as when the countdown ends). */
export async function leadershipCloseBillFloorVotePeriod(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const bill_id = String(formData.get("bill_id") ?? "").trim();
  if (!bill_id) throw new Error("Missing bill id.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const isAdminActor = roleKeys.includes("admin");

  const { data: bill } = await supabase
    .from("bills")
    .select("id, status, chamber_vote_deadline_at, vp_tie_break_pending")
    .eq("id", bill_id)
    .maybeSingle();

  if (!bill) throw new Error("Bill not found.");
  if (bill.status !== "house_floor" && bill.status !== "senate_floor") {
    throw new Error("Floor vote is not open on this bill.");
  }
  const floorChamber = bill.status === "house_floor" ? "house" : "senate";
  if (!isAdminActor && !canAcceptRejectHopperForChamber(roleKeys, floorChamber)) {
    throw new Error(
      floorChamber === "house"
        ? "Only the Speaker or House Deputy may close this House floor vote."
        : "Only the Senate Majority Leader or Senate Deputy may close this Senate floor vote.",
    );
  }
  if (bill.vp_tie_break_pending) {
    throw new Error(
      "The Senate is waiting on a Vice Presidential tie-break — there is no timed voting period to close.",
    );
  }
  if (!bill.chamber_vote_deadline_at) {
    throw new Error("No active chamber vote deadline.");
  }

  const pastIso = new Date(Date.now() - 60_000).toISOString();
  const { error } = await supabase.from("bills").update({ chamber_vote_deadline_at: pastIso }).eq("id", bill_id);
  throwIfPostgrestError(error);

  await finalizeFloorVoteByCastYeaNayPlurality(supabase, bill_id);

  revalidateCongressPagesAndLeadership();
  revalidateBillPage(bill_id);
}
