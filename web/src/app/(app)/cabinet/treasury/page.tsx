import { redirect } from "next/navigation";
import { treasuryApplyTaxPenalties, treasuryIssueTaxWarnings } from "@/app/actions/fiscal";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";
import { TreasuryTools } from "./treasury-tools";

export default async function TreasuryCabinetPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const canAccess =
    roleKeys.includes("secretary_of_treasury") ||
    roleKeys.includes("president") ||
    roleKeys.includes("admin") ||
    roleKeys.includes("staff_super");

  if (!canAccess) redirect("/");

  const [{ data: dashboard }, { data: activeFy }, { data: accounts }] = await Promise.all([
    supabase.rpc("fiscal_treasury_dashboard"),
    supabase
      .from("rp_fiscal_years")
      .select("id, label, tax_penalty_daily_rate, tax_due_days_after_close, tax_warning_lead_days")
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("fiscal_tax_accounts")
      .select("id, user_id, assessed_tax, paid_amount, outstanding_amount, total_penalties, status, due_at")
      .order("outstanding_amount", { ascending: false })
      .limit(200),
  ]);

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
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Cabinet</p>
        <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Treasury operations</h1>
      </header>
      <TreasuryTools
        summary={(dashboard as Record<string, unknown> | null) ?? {}}
        settings={
          (activeFy as { label?: string; tax_penalty_daily_rate?: number; tax_due_days_after_close?: number; tax_warning_lead_days?: number } | null) ??
          null
        }
        rows={rows}
        issueWarningsAction={treasuryIssueTaxWarnings}
        applyPenaltiesAction={treasuryApplyTaxPenalties}
      />
    </div>
  );
}
