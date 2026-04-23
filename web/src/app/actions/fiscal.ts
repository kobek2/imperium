"use server";

import { addHours } from "date-fns";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { processBillDeadlines } from "@/lib/bill-pipeline";
import { buildFederalAppropriationsBillHtml } from "@/lib/build-federal-appropriations-bill-html";
import type { FiscalLineItemRow, FiscalTaxBracketRow } from "@/lib/fiscal-budget-types";
import { lineItemDefaultLabel } from "@/lib/line-item-budget-effects";
import { canFileLegislationInChamber } from "@/lib/legislative-eligibility";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { isActivePresidentialRunningMate } from "@/lib/presidential-running-mate";
import { htmlToPlainText, sanitizeBillHtml } from "@/lib/sanitize-bill-html";
import { getStaffAccess } from "@/lib/staff-access";
import { isPresident } from "@/lib/president";

function revalidateFiscal() {
  revalidatePath("/economy");
  revalidatePath("/economy/federal");
}

function revalidateCongressPagesAndLeadership() {
  revalidatePath("/congress");
  revalidatePath("/congress/house");
  revalidatePath("/congress/senate");
  revalidatePath("/congress/leadership");
}

function normalizeLineItemsForSave(lineItems: FiscalLineItemRow[]): FiscalLineItemRow[] {
  return lineItems.map((row) => ({
    ...row,
    label: lineItemDefaultLabel(row.key),
  }));
}

export type { FiscalLineItemRow, FiscalTaxBracketRow } from "@/lib/fiscal-budget-types";

export async function saveFiscalBudgetDraft(input: {
  fiscalYearId: string;
  taxBrackets: FiscalTaxBracketRow[];
  lineItems: FiscalLineItemRow[];
  /** Deprecated: national metrics live in `national_metrics` (admin). */
  metrics?: Record<string, unknown>;
}): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const pres = await isPresident(supabase, user.id);
  if (!pres) return { ok: false, message: "Only the President may edit the federal budget." };

  const { error } = await supabase.rpc("fiscal_save_budget_draft", {
    p_fiscal_year_id: input.fiscalYearId,
    p_tax_brackets: input.taxBrackets,
    p_line_items: normalizeLineItemsForSave(input.lineItems),
    p_metrics: input.metrics ?? {},
  });
  if (error) return { ok: false, message: error.message };
  revalidateFiscal();
  return { ok: true, message: "Budget draft saved." };
}

/** Scales each draft line item minimum (and raises allocated if needed) by server GDP vs FY opening, capped at +15%. */
export async function applyServerGdpInflationToLineMinima(): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const pres = await isPresident(supabase, user.id);
  if (!pres) return { ok: false, message: "Only the President may run this adjustment." };

  const { data, error } = await supabase.rpc("fiscal_apply_server_gdp_inflation_to_line_minima");
  if (error) return { ok: false, message: error.message };
  revalidateFiscal();
  const ratio = (data as { ratio_applied?: number } | null)?.ratio_applied;
  const extra =
    ratio != null ? ` Applied ratio ${Number(ratio).toFixed(4)} (wallet sum ÷ FY opening GDP, capped).` : "";
  return { ok: true, message: `Line-item minimums updated.${extra}` };
}

export async function submitFiscalBudget(fiscalYearId: string): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const pres = await isPresident(supabase, user.id);
  const staff = await getStaffAccess();
  const canSubmit = pres || staff?.hasFullStaff;
  if (!canSubmit) {
    return {
      ok: false,
      message: "Only the President or a full staff operator (admin / staff_super) may mark the budget submitted.",
    };
  }

  const { error } = await supabase.rpc("fiscal_submit_budget", { p_fiscal_year_id: fiscalYearId });
  if (error) return { ok: false, message: error.message };
  revalidateFiscal();
  return { ok: true, message: "Budget submitted. Economy actions are unlocked for this fiscal year." };
}

export async function closeFiscalYear(): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const pres = await isPresident(supabase, user.id);
  if (!pres) return { ok: false, message: "Only the President may close the fiscal year." };

  const { data, error } = await supabase.rpc("fiscal_close_year");
  if (error) return { ok: false, message: error.message };
  revalidateFiscal();
  const d = data as {
    total_tax_collected?: number;
    total_spending?: number;
    economy_frozen_until_submit?: boolean;
  } | null;
  const tax = d?.total_tax_collected ?? 0;
  const spend = d?.total_spending ?? 0;
  return {
    ok: true,
    message: `Fiscal year closed. Tax collected $${Number(tax).toLocaleString()}; spending $${Number(spend).toLocaleString()}. Submit a budget for the new year to unfreeze the economy.`,
  };
}

function isMissingBillTimerColumn(message: string | undefined) {
  const m = (message ?? "").toLowerCase();
  return m.includes("leadership_deadline_at") || m.includes("chamber_vote_deadline_at");
}

function isMissingContentHtmlColumn(message: string | undefined) {
  const m = (message ?? "").toLowerCase();
  return m.includes("content_html") || m.includes("schema cache");
}

function isMissingAppropriationsColumns(message: string | undefined) {
  const m = (message ?? "").toLowerCase();
  return m.includes("is_federal_appropriations") || m.includes("linked_fiscal_year_id");
}

/**
 * Saves the current draft, then files a House-originating appropriations bill (`submitted` → leadership hopper),
 * using the same HTML pipeline as member-filed legislation.
 */
export async function fileFederalBudgetAppropriationsBill(input: {
  fiscalYearId: string;
  yearLabel: string;
  taxBrackets: FiscalTaxBracketRow[];
  lineItems: FiscalLineItemRow[];
}): Promise<{ ok: boolean; message: string; billId?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const pres = await isPresident(supabase, user.id);
  if (!pres) return { ok: false, message: "Only the President may file the appropriations bill." };

  if (await isActivePresidentialRunningMate(supabase, user.id)) {
    return { ok: false, message: "Presidential running mates may not file legislation in Congress." };
  }

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canFileLegislationInChamber(roleKeys, "house")) {
    return { ok: false, message: "You may not file House legislation with your current roles." };
  }

  const normalizedLines = normalizeLineItemsForSave(input.lineItems);

  const { data: activeFy } = await supabase
    .from("rp_fiscal_years")
    .select("id")
    .eq("status", "active")
    .maybeSingle();
  if (!activeFy?.id || activeFy.id !== input.fiscalYearId) {
    return { ok: false, message: "Appropriations can only be filed for the active fiscal year." };
  }

  const { data: pendingAppRows, error: pendErr } = await supabase
    .from("bills")
    .select("id, status")
    .eq("linked_fiscal_year_id", input.fiscalYearId)
    .eq("is_federal_appropriations", true)
    .limit(40);
  if (pendErr) return { ok: false, message: pendErr.message };
  const terminal = new Set(["dead", "vetoed"]);
  const hasOpenPipeline = (pendingAppRows ?? []).some(
    (r) => !terminal.has(String((r as { status?: string }).status ?? "")),
  );
  if (hasOpenPipeline) {
    return {
      ok: false,
      message: "An appropriations bill for this fiscal year is already in Congress or enrolled.",
    };
  }

  const { error: saveErr } = await supabase.rpc("fiscal_save_budget_draft", {
    p_fiscal_year_id: input.fiscalYearId,
    p_tax_brackets: input.taxBrackets,
    p_line_items: normalizedLines,
    p_metrics: {},
  });
  if (saveErr) return { ok: false, message: saveErr.message };

  const rawHtml = buildFederalAppropriationsBillHtml({
    yearLabel: input.yearLabel,
    taxBrackets: input.taxBrackets,
    lineItems: normalizedLines,
  });
  const content_html = sanitizeBillHtml(rawHtml);
  const content_md = htmlToPlainText(content_html);
  if (!content_md.trim()) {
    return { ok: false, message: "Bill text is empty after sanitization." };
  }

  const title = `Federal appropriations and revenue — ${input.yearLabel.trim() || "Fiscal year"}`;
  const now = new Date();
  const leadership_deadline_at = addHours(now, 12).toISOString();
  const expires_at = addHours(now, 24 * 30).toISOString();

  const appExtras = {
    is_federal_appropriations: true as const,
    linked_fiscal_year_id: input.fiscalYearId,
  };

  let { data: inserted, error } = await supabase
    .from("bills")
    .insert({
      title,
      content_md,
      content_html,
      originating_chamber: "house",
      author_id: user.id,
      expires_at,
      status: "submitted",
      leadership_deadline_at,
      chamber_vote_deadline_at: null,
      ...appExtras,
    })
    .select("id")
    .maybeSingle();

  if (error && isMissingBillTimerColumn(error.message)) {
    const retry = await supabase
      .from("bills")
      .insert({
        title,
        content_md,
        content_html,
        originating_chamber: "house",
        author_id: user.id,
        expires_at,
        status: "submitted",
        ...appExtras,
      })
      .select("id")
      .maybeSingle();
    inserted = retry.data;
    error = retry.error;
  }

  if (error && isMissingContentHtmlColumn(error.message)) {
    const retry = await supabase
      .from("bills")
      .insert({
        title,
        content_md,
        originating_chamber: "house",
        author_id: user.id,
        expires_at,
        status: "submitted",
        leadership_deadline_at,
        chamber_vote_deadline_at: null,
        ...appExtras,
      })
      .select("id")
      .maybeSingle();
    inserted = retry.data;
    error = retry.error;
    if (error && isMissingBillTimerColumn(error.message)) {
      const retry2 = await supabase
        .from("bills")
        .insert({
          title,
          content_md,
          originating_chamber: "house",
          author_id: user.id,
          expires_at,
          status: "submitted",
          ...appExtras,
        })
        .select("id")
        .maybeSingle();
      inserted = retry2.data;
      error = retry2.error;
    }
  }

  if (error && isMissingAppropriationsColumns(error.message)) {
    const retry = await supabase
      .from("bills")
      .insert({
        title,
        content_md,
        content_html,
        originating_chamber: "house",
        author_id: user.id,
        expires_at,
        status: "submitted",
        leadership_deadline_at,
        chamber_vote_deadline_at: null,
      })
      .select("id")
      .maybeSingle();
    inserted = retry.data;
    error = retry.error;
  }

  if (error) return { ok: false, message: error.message };

  await processBillDeadlines(supabase);
  revalidateFiscal();
  revalidateCongressPagesAndLeadership();
  revalidatePath("/directory");
  const billId = (inserted as { id?: string } | null)?.id;
  if (billId) revalidatePath(`/bill/${billId}`);

  return {
    ok: true,
    message: "Draft saved and appropriations bill filed to the House leadership hopper.",
    billId,
  };
}
