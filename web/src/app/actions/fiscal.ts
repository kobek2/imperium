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
import { dbErrorHintsMissingColumn } from "@/lib/db-error-hints";
import { processYearEndParticipationApproval } from "@/lib/approval-ratings";

const TREASURY_ROLE_KEY = "secretary_of_treasury";

function canActorFileAppropriationsBill(params: {
  roleKeys: string[];
  isAdmin: boolean;
  fiscal: {
    appropriations_act_bill_id?: string | null;
  } | null;
}): boolean {
  const { roleKeys, isAdmin, fiscal } = params;
  if (isAdmin || roleKeys.includes("staff_super")) return true;
  if (!fiscal || fiscal.appropriations_act_bill_id) return false;
  return roleKeys.includes("president");
}

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
    base_minimum:
      row.base_minimum != null && Number.isFinite(Number(row.base_minimum))
        ? Number(row.base_minimum)
        : Number(row.minimum),
  }));
}

async function syncDraftLineMinimaToServerInflation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fiscalYearId: string,
): Promise<{ ratio_applied?: number } | null> {
  const { data: budgetMeta } = await supabase
    .from("federal_budgets")
    .select("status")
    .eq("fiscal_year_id", fiscalYearId)
    .maybeSingle();
  if (String((budgetMeta as { status?: string } | null)?.status) !== "draft") {
    return null;
  }

  const { data, error } = await supabase.rpc("fiscal_apply_server_gdp_inflation_to_line_minima");
  if (error) {
    // Older DBs may not have this RPC yet; don't block save/file.
    const m = (error.message ?? "").toLowerCase();
    if (
      m.includes("fiscal_apply_server_gdp_inflation_to_line_minima") ||
      m.includes("schema cache") ||
      m.includes("draft budget") ||
      m.includes("only be inflated")
    ) {
      return null;
    }
    throw new Error(error.message);
  }
  return (data as { ratio_applied?: number } | null) ?? null;
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
  const staff = await getStaffAccess();
  const canEdit = pres || staff?.hasFullStaff;
  if (!canEdit) {
    return {
      ok: false,
      message: "Only the President or a full staff operator (admin / staff_super) may edit the federal budget.",
    };
  }

  const { data: budgetMeta } = await supabase
    .from("federal_budgets")
    .select("status")
    .eq("fiscal_year_id", input.fiscalYearId)
    .maybeSingle();
  if (String((budgetMeta as { status?: string } | null)?.status) === "submitted" && !staff?.hasFullStaff) {
    return {
      ok: false,
      message: "This federal budget is already adopted. Only full staff may override edits.",
    };
  }

  const { error } = await supabase.rpc("fiscal_save_budget_draft", {
    p_fiscal_year_id: input.fiscalYearId,
    p_tax_brackets: input.taxBrackets,
    p_line_items: normalizeLineItemsForSave(input.lineItems),
    p_metrics: input.metrics ?? {},
  });
  if (error) return { ok: false, message: error.message };
  const sync = await syncDraftLineMinimaToServerInflation(supabase, input.fiscalYearId);
  revalidateFiscal();
  const ratioNote =
    sync?.ratio_applied != null
      ? ` Line minima auto-indexed to server GDP ratio ${Number(sync.ratio_applied).toFixed(3)}.`
      : "";
  return { ok: true, message: `Budget draft saved.${ratioNote}` };
}

/** Reindexes draft line minima to the server GDP ratio (wallet sum ÷ FY opening). */
export async function applyServerGdpInflationToLineMinima(): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const pres = await isPresident(supabase, user.id);
  const staff = await getStaffAccess();
  const canEdit = pres || staff?.hasFullStaff;
  if (!canEdit) {
    return {
      ok: false,
      message: "Only the President or a full staff operator (admin / staff_super) may run this adjustment.",
    };
  }

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
  const staff = await getStaffAccess();
  const canClose = pres || staff?.hasFullStaff;
  if (!canClose) {
    return {
      ok: false,
      message: "Only the President or a full staff operator (admin / staff_super) may close the fiscal year.",
    };
  }

  const { data, error } = await supabase.rpc("fiscal_close_year");
  if (error) return { ok: false, message: error.message };
  const yearEndApproval = await processYearEndParticipationApproval(supabase);
  revalidateFiscal();
  const d = data as {
    total_tax_collected?: number;
    total_spending?: number;
    treasury_net_delta?: number;
    us_debt_delta?: number;
    economy_frozen_until_submit?: boolean;
  } | null;
  const tax = d?.total_tax_collected ?? 0;
  const spend = d?.total_spending ?? 0;
  const debtDelta = d?.us_debt_delta ?? 0;
  const treasuryNet = d?.treasury_net_delta ?? 0;
  return {
    ok: true,
    message: `Fiscal year closed. Tax collected $${Number(tax).toLocaleString()}; spending $${Number(spend).toLocaleString()}. Treasury net $${Number(treasuryNet).toLocaleString()}; national debt roll-up $${Number(debtDelta).toLocaleString()}. Year-end approval balancing adjusted ${yearEndApproval.adjustedMembers} member(s). Submit a budget for the new year to unfreeze the economy.`,
  };
}

/** Staff-only: wipe transactional economy + fiscal state except personal wallet balances; restart FY1 with seeded budget/metrics. */
export async function adminEconomyFullResetKeepWallets(): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const staff = await getStaffAccess();
  if (!staff?.hasFullStaff) {
    return { ok: false, message: "Only full staff operators (admin / staff_super) may run a full economy reset." };
  }

  const { data, error } = await supabase.rpc("admin_economy_full_reset_keep_wallets");
  if (error) return { ok: false, message: error.message };

  const d = (data ?? {}) as {
    gdp_opening_total?: number;
    wallet_rows?: number;
  };
  const gdp = Number(d.gdp_opening_total ?? 0);
  const nWallets = Number(d.wallet_rows ?? 0);
  revalidateFiscal();
  revalidatePath("/cabinet/treasury");
  revalidatePath("/directory");
  revalidatePath("/economy");
  revalidatePath("/economy/federal");
  return {
    ok: true,
    message: `Economy reset: FY1 restarted with seeded federal budget and metrics; player wallet balances kept (${nWallets.toLocaleString()} wallets; GDP opening ~$${gdp.toLocaleString(undefined, { maximumFractionDigits: 0 })}). Ledger, PACs, ads inventory, blackjack, party treasuries, federal treasury, and FY2+ cleared.`,
  };
}

export async function startAppropriationClockIfPresidentSeated(): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fiscal_start_appropriation_clock_if_president_seated");
  if (error) return { ok: false, message: error.message };
  revalidateFiscal();
  revalidatePath("/congress");
  return { ok: true, message: "Appropriations clock check complete." };
}

/** Staff-only: start the IRL appropriations countdown on the active fiscal year (default 24h, max 168h). */
export async function adminStartAppropriationsCountdown(hours?: number): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const staff = await getStaffAccess();
  if (!staff?.hasFullStaff) {
    return {
      ok: false,
      message: "Only full staff operators (admin / staff_super) may start the appropriations countdown.",
    };
  }
  const h = hours != null && Number.isFinite(Number(hours)) ? Math.floor(Number(hours)) : 24;
  const { data, error } = await supabase.rpc("admin_start_appropriations_window", { p_hours: h });
  if (error) return { ok: false, message: error.message };
  const row = (data ?? {}) as { appropriation_deadline_at?: string; hours?: number };
  revalidateFiscal();
  revalidatePath("/congress");
  revalidatePath("/admin/economy/overview");
  revalidatePath("/");
  const iso = row.appropriation_deadline_at ? new Date(String(row.appropriation_deadline_at)).toLocaleString() : "";
  return {
    ok: true,
    message: `Appropriations window started (${row.hours ?? h}h). Deadline ${iso}.`,
  };
}

export async function payFiscalTax(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const amount = Number(String(formData.get("amount") ?? "").trim());
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, message: "Enter a valid payment amount." };
  }
  const { data, error } = await supabase.rpc("fiscal_pay_tax", { p_amount: amount });
  if (error) return { ok: false, message: error.message };
  revalidateFiscal();
  revalidatePath("/economy");
  const paid = Number((data as { paid?: number } | null)?.paid ?? 0);
  const remaining = Number((data as { remaining?: number } | null)?.remaining ?? 0);
  return {
    ok: true,
    message: `Tax payment recorded: $${paid.toLocaleString(undefined, { maximumFractionDigits: 2 })}. Remaining balance: $${remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })}.`,
  };
}

export async function treasuryIssueTaxWarnings(scope: "due_soon" | "delinquent" | "all"): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (
    !roleKeys.includes("secretary_of_treasury") &&
    !roleKeys.includes("admin") &&
    !roleKeys.includes("staff_super")
  ) {
    return { ok: false, message: "Only the Secretary of the Treasury may issue tax warnings from the cabinet desk." };
  }

  const { data, error } = await supabase.rpc("fiscal_issue_tax_warning", { p_scope: scope });
  if (error) return { ok: false, message: error.message };
  revalidateFiscal();
  revalidatePath("/cabinet");
  revalidatePath("/cabinet/treasury");
  const warned = Number((data as { warned?: number } | null)?.warned ?? 0);
  return { ok: true, message: `Issued ${warned.toLocaleString()} tax warning(s).` };
}

export async function treasuryApplyTaxPenalties(): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (
    !roleKeys.includes("secretary_of_treasury") &&
    !roleKeys.includes("admin") &&
    !roleKeys.includes("staff_super")
  ) {
    return { ok: false, message: "Only the Secretary of the Treasury may apply tax penalties from the cabinet desk." };
  }

  const { data, error } = await supabase.rpc("fiscal_apply_tax_penalties");
  if (error) return { ok: false, message: error.message };
  revalidateFiscal();
  revalidatePath("/cabinet");
  revalidatePath("/cabinet/treasury");
  const updated = Number((data as { updated?: number } | null)?.updated ?? 0);
  return { ok: true, message: `Penalty processing updated ${updated.toLocaleString()} account(s).` };
}

export async function adminUpdateFiscalConfig(input: {
  appropriationWindowHours?: number;
  taxDueDaysAfterClose?: number;
  taxPenaltyDailyRate?: number;
  taxWarningLeadDays?: number;
}): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fiscal_admin_update_config", {
    p_appropriation_window_hours:
      input.appropriationWindowHours != null ? Number(input.appropriationWindowHours) : null,
    p_tax_due_days_after_close: input.taxDueDaysAfterClose != null ? Number(input.taxDueDaysAfterClose) : null,
    p_tax_penalty_daily_rate: input.taxPenaltyDailyRate != null ? Number(input.taxPenaltyDailyRate) : null,
    p_tax_warning_lead_days: input.taxWarningLeadDays != null ? Number(input.taxWarningLeadDays) : null,
  });
  if (error) return { ok: false, message: error.message };
  revalidateFiscal();
  revalidatePath("/admin/economy/overview");
  return { ok: true, message: "Fiscal settings updated." };
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

  if (await isActivePresidentialRunningMate(supabase, user.id)) {
    return { ok: false, message: "Presidential running mates may not file legislation in Congress." };
  }

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const isAdminActor = roleKeys.includes("admin") || roleKeys.includes("staff_super");

  const normalizedLines = normalizeLineItemsForSave(input.lineItems);

  const { data: activeFy } = await supabase
    .from("rp_fiscal_years")
    .select(
      "id, appropriations_act_bill_id, appropriation_clock_started_at, budget_initial_window_ends_at, budget_treasury_override_until",
    )
    .eq("status", "active")
    .maybeSingle();
  if (!activeFy?.id || activeFy.id !== input.fiscalYearId) {
    return { ok: false, message: "Appropriations can only be filed for the active fiscal year." };
  }
  const staff = await getStaffAccess();
  const staffBypass = Boolean(staff?.hasFullStaff);
  if (!staffBypass && !(activeFy as { appropriation_clock_started_at?: string | null }).appropriation_clock_started_at) {
    return {
      ok: false,
      message:
        "Staff have not started the appropriations countdown yet. Ask an admin to open Admin → Economy overview → Start appropriations countdown, then file again.",
    };
  }
  const appropriationsAuthorized = canActorFileAppropriationsBill({
    roleKeys,
    isAdmin: isAdminActor,
    fiscal: activeFy,
  });
  if (!appropriationsAuthorized) {
    return {
      ok: false,
      message:
        "Appropriations filing is restricted to the President (or admin / staff_super override) while no appropriations act is enrolled for the active fiscal year.",
    };
  }
  const canHouseMember = canFileLegislationInChamber(roleKeys, "house");
  const treasurySecretaryHouseAppropriations =
    roleKeys.includes(TREASURY_ROLE_KEY) && appropriationsAuthorized;
  if (!canHouseMember && !treasurySecretaryHouseAppropriations) {
    return { ok: false, message: "You may not file House legislation with your current roles." };
  }

  const { data: pendingAppRows, error: pendErr } = await supabase
    .from("bills")
    .select("id, status")
    .eq("linked_fiscal_year_id", input.fiscalYearId)
    .eq("is_federal_appropriations", true)
    .limit(40);
  if (pendErr) return { ok: false, message: pendErr.message };
  const terminal = new Set(["dead", "vetoed", "failed", "expired", "rejected"]);
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
  await syncDraftLineMinimaToServerInflation(supabase, input.fiscalYearId);

  const { data: refreshedBudget } = await supabase
    .from("federal_budgets")
    .select("line_items")
    .eq("fiscal_year_id", input.fiscalYearId)
    .maybeSingle();
  const billLines = Array.isArray((refreshedBudget as { line_items?: unknown } | null)?.line_items)
    ? normalizeLineItemsForSave(
        ((refreshedBudget as { line_items: unknown[] }).line_items ?? []).map((row) => ({
          key: String((row as { key?: unknown }).key ?? ""),
          label: String((row as { label?: unknown }).label ?? ""),
          base_minimum: Number((row as { base_minimum?: unknown }).base_minimum ?? Number((row as { minimum?: unknown }).minimum ?? 0)),
          minimum: Number((row as { minimum?: unknown }).minimum ?? 0),
          allocated: Number((row as { allocated?: unknown }).allocated ?? 0),
        })),
      )
    : normalizedLines;

  const rawHtml = buildFederalAppropriationsBillHtml({
    yearLabel: input.yearLabel,
    taxBrackets: input.taxBrackets,
    lineItems: billLines,
  });
  const content_html = sanitizeBillHtml(rawHtml);
  const content_md = htmlToPlainText(content_html);
  if (!content_md.trim()) {
    return { ok: false, message: "Bill text is empty after sanitization." };
  }

  const title = `Federal appropriations and revenue — ${input.yearLabel.trim() || "Fiscal year"}`;
  const now = new Date();
  const leadership_deadline_at: string | null = null;
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

  if (
    error &&
    dbErrorHintsMissingColumn(error.message, ["leadership_deadline_at", "chamber_vote_deadline_at"])
  ) {
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

  if (error && dbErrorHintsMissingColumn(error.message, ["content_html", "schema cache"])) {
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
    if (
      error &&
      dbErrorHintsMissingColumn(error.message, ["leadership_deadline_at", "chamber_vote_deadline_at"])
    ) {
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

  if (error && dbErrorHintsMissingColumn(error.message, ["is_federal_appropriations", "linked_fiscal_year_id"])) {
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
