"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { processBillDeadlines } from "@/lib/bill-pipeline";
import { applyApprovalDelta } from "@/lib/approval-ratings";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import {
  canAcceptRejectHopperForChamber,
  canLeadershipEditBillContent,
} from "@/lib/role-capabilities";
import {
  escapeHtmlPlain,
  htmlToPlainText,
  legacyMdToEditorHtml,
  sanitizeBillHtml,
} from "@/lib/sanitize-bill-html";
import type { BillChamber } from "@/lib/bill-types";
import { isDebateStatus, leadershipEditChamberForBillStatus } from "@/lib/legislative-helpers";
import { isActivePresidentialRunningMate } from "@/lib/presidential-running-mate";
import { throwIfPostgrestError } from "@/lib/supabase-error";

function revalidateBill(billId: string) {
  revalidatePath(`/bill/${billId}`);
  revalidatePath("/congress");
  revalidatePath("/congress/leadership");
}

export async function proposeBillAmendment(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const bill_id = String(formData.get("bill_id"));
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const rawHtml = String(formData.get("amended_content_html") ?? "").trim();
  const content_html = rawHtml ? sanitizeBillHtml(rawHtml) : "";
  const amended_text = htmlToPlainText(content_html);

  if (!title || !description || !amended_text) {
    throw new Error("Title, description, and amended bill text are required.");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const isAdminActor = roleKeys.includes("admin");

  if (!isAdminActor && (await isActivePresidentialRunningMate(supabase, user.id))) {
    throw new Error("Presidential running mates may not propose amendments.");
  }

  const { data: bill } = await supabase
    .from("bills")
    .select("id, status, originating_chamber, author_id")
    .eq("id", bill_id)
    .maybeSingle();

  if (!bill || !isDebateStatus(String(bill.status))) {
    throw new Error("Amendments may only be proposed while the bill is in debate.");
  }

  const editChamber = leadershipEditChamberForBillStatus(String(bill.status), bill.originating_chamber as BillChamber);
  const isAuthor = bill.author_id === user.id;
  const isLeader = editChamber && canLeadershipEditBillContent(roleKeys, editChamber);
  if (!isAuthor && !isLeader) {
    throw new Error("Only the bill author or chamber leadership may propose amendments.");
  }

  const { error } = await supabase.from("bill_amendments").insert({
    bill_id,
    proposed_by: user.id,
    title,
    description,
    amended_text,
    status: "pending",
  });
  throwIfPostgrestError(error);

  await processBillDeadlines(supabase);
  revalidateBill(bill_id);
}

export async function resolveBillAmendment(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const amendment_id = String(formData.get("amendment_id"));
  const decision = String(formData.get("decision")); // adopt | reject | table
  const notes = String(formData.get("notes") ?? "").trim();

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const isAdminActor = roleKeys.includes("admin");

  if (!isAdminActor && (await isActivePresidentialRunningMate(supabase, user.id))) {
    throw new Error("Presidential running mates may not resolve amendments.");
  }

  const { data: row } = await supabase
    .from("bill_amendments")
    .select("id, bill_id, status, amended_text, proposed_by")
    .eq("id", amendment_id)
    .maybeSingle();

  if (!row || row.status !== "pending") {
    throw new Error("This amendment is not pending.");
  }

  const { data: bill } = await supabase
    .from("bills")
    .select("id, status, originating_chamber, content_html, content_md")
    .eq("id", row.bill_id)
    .maybeSingle();

  if (!bill || !isDebateStatus(String(bill.status))) {
    throw new Error("This amendment can no longer be resolved.");
  }

  const editChamber = leadershipEditChamberForBillStatus(String(bill.status), bill.originating_chamber as BillChamber);
  if (!editChamber || !canAcceptRejectHopperForChamber(roleKeys, editChamber)) {
    throw new Error("Only chamber leadership may resolve amendments.");
  }

  const nextStatus = decision === "adopt" ? "adopted" : decision === "table" ? "tabled" : decision === "reject" ? "rejected" : "";
  if (!nextStatus) throw new Error("Invalid decision.");

  if (decision === "adopt") {
    const amendedMd = String(row.amended_text ?? "").trim();
    if (!amendedMd) throw new Error("Adopted amendment is missing amended text.");
    const content_html =
      sanitizeBillHtml(legacyMdToEditorHtml(amendedMd) ?? `<pre>${escapeHtmlPlain(amendedMd)}</pre>`);
    const content_md = amendedMd;

    const previousHtml = (bill as { content_html?: string | null }).content_html?.trim();
    const previousMd = (bill as { content_md?: string | null }).content_md?.trim();
    const snapshot =
      previousHtml && previousHtml.length > 0
        ? previousHtml
        : `<pre>${escapeHtmlPlain(previousMd ?? "")}</pre>`;

    if (snapshot !== content_html) {
      const { error: verErr } = await supabase.from("bill_versions").insert({
        bill_id: row.bill_id,
        content_html: snapshot,
        edited_by: user.id,
      });
      if (verErr && !verErr.message?.includes("bill_versions") && verErr.code !== "PGRST205") {
        console.warn("[resolveBillAmendment] version insert:", verErr.message);
      }
    }

    const { error: upBill } = await supabase
      .from("bills")
      .update({ content_html, content_md })
      .eq("id", row.bill_id);
    throwIfPostgrestError(upBill);

    await applyApprovalDelta(supabase, String(row.proposed_by), 3, "Amendment adopted");
  }

  const { error: upAm } = await supabase
    .from("bill_amendments")
    .update({
      status: nextStatus,
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
      notes: notes || null,
    })
    .eq("id", amendment_id);
  throwIfPostgrestError(upAm);

  await processBillDeadlines(supabase);
  revalidateBill(String(row.bill_id));
}
