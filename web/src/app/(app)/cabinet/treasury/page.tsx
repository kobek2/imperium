import Link from "next/link";
import { redirect } from "next/navigation";
import { treasuryApplyTaxPenalties, treasuryIssueTaxWarnings } from "@/app/actions/fiscal";
import { canAccessCabinetHub } from "@/lib/cabinet-hub";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { lineItemDefaultLabel } from "@/lib/line-item-budget-effects";
import { getServerAuth } from "@/lib/supabase/server";
import {
  TreasuryAppropriationsPipeline,
  type AppropriationsBillRow,
  type TreasuryLineRow,
} from "./treasury-appropriations-pipeline";
import { TreasuryTools } from "./treasury-tools";

type FySettings = {
  label?: string;
  tax_penalty_daily_rate?: number;
  tax_due_days_after_close?: number;
  tax_warning_lead_days?: number;
};

type ActiveFyRow = {
  id: string;
  label: string;
  tax_penalty_daily_rate?: number;
  tax_due_days_after_close?: number;
  tax_warning_lead_days?: number;
  appropriation_deadline_at?: string | null;
  appropriations_act_bill_id?: string | null;
  started_at?: string;
};

function parseLineItemsForTreasury(raw: unknown): TreasuryLineRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const key = String((row as { key?: unknown }).key ?? "");
    const labelRaw = String((row as { label?: unknown }).label ?? "").trim();
    return {
      key,
      label: labelRaw || lineItemDefaultLabel(key),
      minimum: Number((row as { minimum?: unknown }).minimum ?? 0),
      allocated: Number((row as { allocated?: unknown }).allocated ?? 0),
    };
  });
}

export default async function TreasuryCabinetPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canAccessCabinetHub(roleKeys)) redirect("/");

  const [{ data: dashboard }, { data: activeFy }, { data: federalTreasuryRow }] = await Promise.all([
    supabase.rpc("fiscal_treasury_dashboard"),
    supabase
      .from("rp_fiscal_years")
      .select(
        "id, label, tax_penalty_daily_rate, tax_due_days_after_close, tax_warning_lead_days, appropriation_deadline_at, appropriations_act_bill_id, started_at",
      )
      .eq("status", "active")
      .maybeSingle(),
    supabase.from("federal_treasury").select("balance").eq("id", 1).maybeSingle(),
  ]);

  const taxOpsFiscalYearId = String((dashboard as { fiscal_year_id?: string | null } | null)?.fiscal_year_id ?? "").trim();
  const fyActive = activeFy as ActiveFyRow | null;

  const [{ data: taxOpsFy }, { data: accounts }, { data: budgetForActive }, { data: linkedAppBillsRaw }, taxRpcResult] =
    await Promise.all([
      taxOpsFiscalYearId
        ? supabase
            .from("rp_fiscal_years")
            .select("id, label, tax_penalty_daily_rate, tax_due_days_after_close, tax_warning_lead_days")
            .eq("id", taxOpsFiscalYearId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      taxOpsFiscalYearId
        ? supabase
            .from("fiscal_tax_accounts")
            .select("id, user_id, assessed_tax, paid_amount, outstanding_amount, total_penalties, status, due_at")
            .eq("fiscal_year_id", taxOpsFiscalYearId)
            .order("outstanding_amount", { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [] as const }),
      fyActive?.id
        ? supabase.from("federal_budgets").select("status, line_items").eq("fiscal_year_id", fyActive.id).maybeSingle()
        : Promise.resolve({ data: null }),
      fyActive?.id
        ? supabase
            .from("bills")
            .select("id, title, status, signed_at, created_at")
            .eq("linked_fiscal_year_id", fyActive.id)
            .eq("is_federal_appropriations", true)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as const }),
      supabase.rpc("fiscal_estimate_ytd_income_tax"),
    ]);
  const taxRpcErr = taxRpcResult.error;
  const taxRpc = taxRpcResult.data;

  const settingsFy = (taxOpsFy as FySettings | null) ?? (activeFy as FySettings | null) ?? null;

  const terminalBill = new Set(["dead", "vetoed"]);
  const linkedAppBills = (linkedAppBillsRaw ?? []) as AppropriationsBillRow[];
  const inCongressBills = linkedAppBills.filter(
    (r) => !terminalBill.has(String(r.status ?? "")) && String(r.status) !== "law",
  );

  const enrolledId = fyActive?.appropriations_act_bill_id ?? null;
  let enrolledBillTitle: string | null = null;
  let enrolledSignedAt: string | null = null;
  if (enrolledId) {
    const fromList = linkedAppBills.find((x) => x.id === enrolledId);
    if (fromList) {
      enrolledBillTitle = fromList.title ?? null;
      enrolledSignedAt = fromList.signed_at ?? null;
    } else {
      const { data: eb } = await supabase.from("bills").select("title, signed_at").eq("id", enrolledId).maybeSingle();
      enrolledBillTitle = String((eb as { title?: string } | null)?.title ?? "") || null;
      enrolledSignedAt = (eb as { signed_at?: string | null } | null)?.signed_at ?? null;
    }
  }

  const governmentShutdown = Boolean(
    fyActive?.appropriation_deadline_at &&
      !fyActive?.appropriations_act_bill_id &&
      new Date(fyActive.appropriation_deadline_at) < new Date(),
  );

  const lineRows = parseLineItemsForTreasury((budgetForActive as { line_items?: unknown } | null)?.line_items);
  const totalAllocated = lineRows.reduce((s, r) => s + (Number.isFinite(r.allocated) ? r.allocated : 0), 0);
  const federalTreasuryBalance = Number((federalTreasuryRow as { balance?: number } | null)?.balance ?? 0);
  const estimatedIncomeTaxYtd =
    !taxRpcErr && taxRpc && typeof taxRpc === "object"
      ? Number((taxRpc as Record<string, unknown>).estimated_tax ?? 0)
      : null;

  const userIds = [...new Set((accounts ?? []).map((a) => String((a as { user_id?: string }).user_id ?? "")))].filter(Boolean);
  const { data: profiles } =
    userIds.length > 0
      ? await supabase.from("profiles").select("id, character_name, discord_username").in("id", userIds)
      : { data: [] as const };
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  const rows = (accounts ?? []).map((a) => {
    const row = a as {
      id: string;
      user_id: string;
      assessed_tax: number;
      paid_amount: number;
      outstanding_amount: number;
      total_penalties: number;
      status: string;
      due_at: string;
    };
    const p = profileById.get(row.user_id) as { character_name?: string | null; discord_username?: string | null } | undefined;
    return {
      ...row,
      label: p?.character_name?.trim() || p?.discord_username?.trim() || row.user_id.slice(0, 8),
    };
  });

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link href="/cabinet" className="text-sm font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline">
          ← Cabinet departments
        </Link>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Cabinet</p>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Treasury operations</h1>
        </div>
      </header>

      {fyActive ? (
        <TreasuryAppropriationsPipeline
          fiscalYearLabel={fyActive.label}
          budgetStatus={(budgetForActive as { status?: string } | null)?.status ?? null}
          appropriationDeadlineAt={fyActive.appropriation_deadline_at ?? null}
          governmentShutdown={governmentShutdown}
          enrolledBillId={enrolledId}
          enrolledBillTitle={enrolledBillTitle}
          enrolledSignedAt={enrolledSignedAt}
          inCongressBills={inCongressBills}
          federalTreasuryBalance={federalTreasuryBalance}
          estimatedIncomeTaxYtd={estimatedIncomeTaxYtd}
          lineRows={lineRows}
          totalAllocated={totalAllocated}
        />
      ) : null}

      <TreasuryTools
        summary={(dashboard as Record<string, unknown> | null) ?? {}}
        settings={settingsFy}
        rows={rows}
        issueWarningsAction={treasuryIssueTaxWarnings}
        applyPenaltiesAction={treasuryApplyTaxPenalties}
      />
    </div>
  );
}
