"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { formatBudgetMillions } from "@/lib/city-fiscal-data";
import { throwIfPostgrestError } from "@/lib/supabase-error";

export type MayorActionResult = { ok: boolean; message: string };

function revalidateMayorPaths() {
  revalidatePath("/mayor");
  revalidatePath("/council");
  revalidatePath("/directory");
  revalidatePath("/imperium");
  revalidatePath("/elections");
}

export async function assignDepartmentTask(input: {
  departmentKey: string;
  title: string;
  instructions: string;
}): Promise<MayorActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mayor_assign_department_task", {
    p_department_key: input.departmentKey,
    p_title: input.title,
    p_instructions: input.instructions,
  });
  if (error) return { ok: false, message: error.message };
  revalidateMayorPaths();
  return { ok: true, message: `Directive sent to ${input.departmentKey.replace(/_/g, " ")}.` };
}

export async function requestDepartmentTaskUpdate(taskId: string): Promise<MayorActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mayor_request_task_update", { p_task_id: taskId });
  if (error) return { ok: false, message: error.message };
  revalidateMayorPaths();
  return { ok: true, message: "Status update received from department head." };
}

export async function closeDepartmentTask(taskId: string): Promise<MayorActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mayor_close_department_task", { p_task_id: taskId });
  if (error) return { ok: false, message: error.message };
  revalidateMayorPaths();
  return { ok: true, message: "Directive marked complete." };
}

export async function proposeCityBudget(input: {
  finance: number;
  police: number;
  publicWorks: number;
  parks: number;
  planning: number;
}): Promise<MayorActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mayor_propose_city_budget", {
    p_finance: input.finance,
    p_police: input.police,
    p_public_works: input.publicWorks,
    p_parks: input.parks,
    p_planning: input.planning,
  });
  if (error) return { ok: false, message: error.message };
  revalidateMayorPaths();
  const row = data as {
    fiscal_year?: number;
    projected_deficit_millions?: number;
    warning?: string | null;
    status?: string;
    passed?: boolean;
    yeas?: number;
    nays?: number;
  } | null;
  const total =
    input.finance + input.police + input.publicWorks + input.parks + input.planning;
  if (row?.status === "awaiting_mayor" || (row?.passed && row?.status !== "council_vote")) {
    return {
      ok: true,
      message: `FY${row?.fiscal_year ?? "?"} budget passed council ${row?.yeas ?? "?"}–${row?.nays ?? "?"} (NPC-only). Awaiting mayor signature.`,
    };
  }
  if (row?.status === "council_vote") {
    return {
      ok: true,
      message: `FY${row?.fiscal_year ?? "?"} budget sent to council for vote (${total}M total).`,
    };
  }
  const deficitNote =
    row?.projected_deficit_millions != null && row.projected_deficit_millions < 0
      ? ` Projected deficit: ${Math.round(row.projected_deficit_millions)}M.`
      : "";
  return {
    ok: true,
    message: `FY${row?.fiscal_year ?? "?"} budget sent to council (${total}M total).${deficitNote}${row?.warning ? ` ${row.warning}` : ""}`,
  };
}

export async function updateFiscalProposal(input: {
  propertyTaxRatePct: number;
  businessTaxRatePct: number;
  incomeTaxEnabled: boolean;
  incomeTaxFlat: boolean;
  incomeTaxLowPct: number;
  incomeTaxMidPct: number;
  incomeTaxHighPct: number;
  finance: number;
  police: number;
  publicWorks: number;
  parks: number;
  planning: number;
}): Promise<MayorActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mayor_update_fiscal_proposal", {
    p_property_tax_rate_pct: input.propertyTaxRatePct,
    p_business_tax_rate_pct: input.businessTaxRatePct,
    p_income_tax_enabled: input.incomeTaxEnabled,
    p_income_tax_flat: input.incomeTaxFlat,
    p_income_tax_low_pct: input.incomeTaxLowPct,
    p_income_tax_mid_pct: input.incomeTaxMidPct,
    p_income_tax_high_pct: input.incomeTaxHighPct,
    p_finance: input.finance,
    p_police: input.police,
    p_public_works: input.publicWorks,
    p_parks: input.parks,
    p_planning: input.planning,
  });
  if (error) return { ok: false, message: error.message };
  revalidateMayorPaths();
  const total =
    input.finance + input.police + input.publicWorks + input.parks + input.planning;
  return {
    ok: true,
    message: `Fiscal draft saved (${total}M total department allocation).`,
  };
}

export async function councilBudgetVote(budgetId: string, vote: "yea" | "nay"): Promise<MayorActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("council_member_budget_vote", {
    p_budget_id: budgetId,
    p_vote: vote,
  });
  if (error) return { ok: false, message: error.message };
  revalidateMayorPaths();
  const row = data as {
    passed?: boolean;
    yeas?: number;
    nays?: number;
    pending?: boolean;
    player_votes?: number;
    required_votes?: number;
    vote_closes_at?: string;
    deficit_millions?: number;
    supermajority_required?: boolean;
    status?: string;
  } | null;
  if (row?.pending) {
    const closesNote = row.vote_closes_at
      ? ` Vote closes ~${new Date(row.vote_closes_at).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })} unless all player seats vote first.`
      : "";
    return {
      ok: true,
      message: `Vote recorded (${row.player_votes ?? "?"}/${row.required_votes ?? "?"} player seats).${closesNote}`,
    };
  }
  if (row?.passed) {
    if (row.status === "awaiting_mayor") {
      return {
        ok: true,
        message: `Budget passed council ${row.yeas ?? 0}–${row.nays ?? 0}${row.supermajority_required ? " (supermajority)" : ""}. Sent to the mayor for signature.`,
      };
    }
    const deficitNote =
      row.deficit_millions != null && row.deficit_millions < 0
        ? ` Treasury adjusted by ${Math.round(row.deficit_millions)}M deficit.`
        : " Treasury updated.";
    return {
      ok: true,
      message: `Budget passed ${row.yeas ?? 0}–${row.nays ?? 0}${row.supermajority_required ? " (supermajority)" : ""}.${deficitNote}`,
    };
  }
  return { ok: true, message: `Budget failed ${row?.yeas ?? 0}–${row?.nays ?? 0}.` };
}

export async function syncCouncilCaucus(): Promise<MayorActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sync_campaign_council_caucus");
  throwIfPostgrestError(error);
  revalidateMayorPaths();
  const row = data as { members?: number; player_seats?: number } | null;
  return {
    ok: true,
    message: `Council caucus synced (${row?.members ?? 0} seats, ${row?.player_seats ?? 0} player-held).`,
  };
}

export async function mayorSignBudget(budgetId: string): Promise<MayorActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mayor_sign_budget", { p_budget_id: budgetId });
  if (error) return { ok: false, message: error.message };

  try {
    const { data: budgetRow } = await supabase
      .from("city_budgets")
      .select("fiscal_year, projected_deficit_millions")
      .eq("id", budgetId)
      .maybeSingle();
    const { data: lines } = await supabase
      .from("city_budget_lines")
      .select("department_key, amount_millions")
      .eq("budget_id", budgetId);
    if (budgetRow && lines?.length) {
      const { applyBudgetMetricsEngine } = await import("@/app/actions/city-metrics");
      await applyBudgetMetricsEngine({
        departments: lines.map((l) => ({
          departmentKey: l.department_key,
          amountMillions: Number(l.amount_millions),
        })),
        deficitMillions: Number(budgetRow.projected_deficit_millions ?? 0),
        fiscalYear: Number(budgetRow.fiscal_year),
      });
    }
  } catch (metricsError) {
    console.warn("[mayorSignBudget] metrics engine:", metricsError);
  }

  revalidateMayorPaths();
  const row = data as {
    summary?: string;
    deficit_millions?: number;
    treasury_balance_millions?: number;
  } | null;
  const balanceNote =
    row?.treasury_balance_millions != null
      ? ` Treasury now ${formatBudgetMillions(row.treasury_balance_millions)}.`
      : row?.deficit_millions != null
        ? ` Biennial balance ${formatBudgetMillions(row.deficit_millions)}.`
        : "";
  const effectNote = row?.summary ? ` ${row.summary}` : "";
  return {
    ok: true,
    message: `Budget signed and enacted.${balanceNote}${effectNote}`,
  };
}

export async function mayorVetoBudget(budgetId: string): Promise<MayorActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mayor_veto_budget", { p_budget_id: budgetId });
  if (error) return { ok: false, message: error.message };
  revalidateMayorPaths();
  return { ok: true, message: "Budget vetoed." };
}

export async function mayorSignOrdinance(ordinanceId: string): Promise<MayorActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mayor_sign_ordinance", {
    p_ordinance_id: ordinanceId,
  });
  if (error) {
    const hint =
      error.message.includes("not awaiting mayor")
        ? " This bill may still be in council vote — refresh the page."
        : "";
    return { ok: false, message: `${error.message}${hint}` };
  }

  try {
    const { data: ordinance } = await supabase
      .from("city_ordinance_proposals")
      .select("category, issue_key, stance_key, stance_params, title")
      .eq("id", ordinanceId)
      .maybeSingle();
    if (ordinance) {
      const { applyOrdinanceMetricsEngine } = await import("@/app/actions/city-metrics");
      await applyOrdinanceMetricsEngine({
        category: ordinance.category,
        issueKey: ordinance.issue_key,
        stanceKey: ordinance.stance_key,
        stanceParams: ordinance.stance_params as {
          rate_delta: number;
          earmark_services_pct: number;
        } | null,
        title: ordinance.title,
      });
    }
  } catch (metricsError) {
    console.warn("[mayorSignOrdinance] metrics engine:", metricsError);
  }

  revalidateMayorPaths();
  const row = data as { summary?: string } | null;
  const effectNote = row?.summary ? ` City impacts: ${row.summary}.` : "";
  return { ok: true, message: `Ordinance signed and enacted.${effectNote} Check department briefings.` };
}

export async function mayorVetoOrdinance(ordinanceId: string): Promise<MayorActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mayor_veto_ordinance", {
    p_ordinance_id: ordinanceId,
  });
  if (error) return { ok: false, message: error.message };
  revalidateMayorPaths();
  return { ok: true, message: "Ordinance vetoed." };
}

export async function appointDepartmentHead(input: {
  departmentKey: string;
  simPoliticianId: string;
}): Promise<MayorActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mayor_appoint_department_head", {
    p_department: input.departmentKey,
    p_sim_politician_id: input.simPoliticianId,
  });
  if (error) return { ok: false, message: error.message };
  revalidateMayorPaths();
  return { ok: true, message: "Department head appointed." };
}

export async function removeDepartmentHead(departmentKey: string): Promise<MayorActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mayor_remove_department_head", {
    p_department: departmentKey,
  });
  if (error) return { ok: false, message: error.message };
  revalidateMayorPaths();
  return { ok: true, message: "Department head removed. Position is vacant." };
}

export async function issueMayorPublicStatement(input: {
  body: string;
  templateKey?: string | null;
}): Promise<MayorActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mayor_issue_public_statement", {
    p_body: input.body.trim(),
    p_template_key: input.templateKey ?? null,
  });
  if (error) return { ok: false, message: error.message };
  revalidateMayorPaths();
  return { ok: true, message: "Public statement published." };
}

export async function issueMayorExecutiveOrder(input: {
  title: string;
  body: string;
  templateKey?: string | null;
}): Promise<MayorActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mayor_issue_executive_order", {
    p_title: input.title.trim(),
    p_body: input.body.trim(),
    p_template_key: input.templateKey ?? null,
  });
  if (error) return { ok: false, message: error.message };
  revalidateMayorPaths();
  return { ok: true, message: "Executive order issued." };
}
