import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/server";
import { requireStaffPage } from "@/lib/staff-access";
import { POLITICAL_ROLE_LABELS } from "@/config/political-roles";
import type { NationalMetricsRow } from "@/lib/national-metrics-types";
import { EconomyOverviewUnlock } from "./economy-overview-unlock";
import { EconomyFiscalConfig } from "./economy-fiscal-config";
import { EconomyAppropriationsWindowControls } from "./economy-appropriations-window-controls";
import { EconomyFiscalAdminControls } from "./economy-fiscal-admin-controls";
import { NationalMetricsAdminForm } from "@/app/(app)/economy/federal/national-metrics-admin-form";

export default async function AdminEconomyOverviewPage() {
  const access = await requireStaffPage("economy");
  const { supabase } = await getServerAuth();
  if (!supabase) redirect("/admin");

  const { data: activeFy } = await supabase
    .from("rp_fiscal_years")
    .select(
      "id, label, year_index, status, appropriation_window_hours, appropriation_deadline_at, appropriations_act_bill_id, economy_activity_frozen, tax_due_days_after_close, tax_penalty_daily_rate, tax_warning_lead_days",
    )
    .eq("status", "active")
    .maybeSingle();

  const { data: fyBudget } = activeFy?.id
    ? await supabase.from("federal_budgets").select("status").eq("fiscal_year_id", activeFy.id).maybeSingle()
    : { data: null };
  const { data: activeMetrics } = activeFy?.id
    ? await supabase.from("national_metrics").select("*").eq("fiscal_year_id", activeFy.id).maybeSingle()
    : { data: null };

  const [{ data: profiles }, { data: wallets }, { data: pacs }, { data: ledger }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, character_name, party, office_role")
      .order("character_name", { ascending: true })
      .limit(500),
    supabase.from("economy_wallets").select("user_id, balance, last_collected_at"),
    supabase.from("economy_pacs").select("user_id, level, updated_at"),
    supabase
      .from("economy_ledger")
      .select("id, wallet_user_id, delta, balance_after, kind, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(150),
  ]);

  const walletByUser = new Map((wallets ?? []).map((w) => [w.user_id as string, w]));
  const pacByUser = new Map((pacs ?? []).map((p) => [p.user_id as string, p]));
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  return (
    <div className="max-w-6xl space-y-8 text-sm text-[var(--psc-muted)]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Staff · Economy</p>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Economy overview</h1>
          <p className="mt-2 max-w-2xl">
            Wallets, PAC levels, primary office role, and recent ledger lines. Use this to spot anomalies; all writes still go
            through game RPCs.
          </p>
        </div>
        <Link href="/admin/economy" className="text-xs font-semibold text-[var(--psc-accent)] underline underline-offset-2">
          ← Economy admin hub
        </Link>
      </div>

      <EconomyOverviewUnlock
        fiscalYearId={(activeFy as { id?: string } | null)?.id ?? null}
        fiscalYearLabel={String((activeFy as { label?: string } | null)?.label ?? "Active FY")}
        budgetStatus={fyBudget ? String((fyBudget as { status: string }).status) : null}
        canMarkSubmitted={access.hasFullStaff}
      />
      {activeFy ? (
        <EconomyFiscalConfig
          canEdit={access.hasFullStaff}
          initial={{
            appropriationWindowHours: Number((activeFy as { appropriation_window_hours?: number }).appropriation_window_hours ?? 24),
            taxDueDaysAfterClose: Number((activeFy as { tax_due_days_after_close?: number }).tax_due_days_after_close ?? 7),
            taxPenaltyDailyRate: Number((activeFy as { tax_penalty_daily_rate?: number }).tax_penalty_daily_rate ?? 0.05),
            taxWarningLeadDays: Number((activeFy as { tax_warning_lead_days?: number }).tax_warning_lead_days ?? 2),
          }}
        />
      ) : null}
      {activeFy?.id ? (
        <EconomyAppropriationsWindowControls
          fiscalYearLabel={String((activeFy as { label?: string }).label ?? "Active FY")}
          fiscalYearIndex={Number((activeFy as { year_index?: number }).year_index ?? 1)}
          appropriationDeadlineAt={
            (activeFy as { appropriation_deadline_at?: string | null }).appropriation_deadline_at ?? null
          }
          appropriationsEnrolled={Boolean((activeFy as { appropriations_act_bill_id?: string | null }).appropriations_act_bill_id)}
          economyFrozen={Boolean((activeFy as { economy_activity_frozen?: boolean | null }).economy_activity_frozen)}
          canRun={access.hasFullStaff}
        />
      ) : null}
      {activeFy?.id ? (
        <>
          <NationalMetricsAdminForm
            fiscalYearId={activeFy.id}
            initial={activeMetrics as NationalMetricsRow | null}
          />
          <EconomyFiscalAdminControls
            fiscalYearLabel={String((activeFy as { label?: string } | null)?.label ?? "Active FY")}
            canRun={access.hasFullStaff}
          />
        </>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Players &amp; economy rows</h2>
        <p className="text-xs">
          Showing up to 500 profiles with known directory order. Balances and PACs join when present.
        </p>
        <div className="overflow-x-auto rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]">
          <table className="w-full min-w-[880px] text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--psc-border)] text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
                <th className="px-2 py-2">Character</th>
                <th className="px-2 py-2">Party</th>
                <th className="px-2 py-2">Office role</th>
                <th className="px-2 py-2">Wallet</th>
                <th className="px-2 py-2">Last collect</th>
                <th className="px-2 py-2">PAC level</th>
              </tr>
            </thead>
            <tbody>
              {(profiles ?? []).map((p) => {
                const id = p.id as string;
                const w = walletByUser.get(id) as { balance?: number; last_collected_at?: string } | undefined;
                const pac = pacByUser.get(id) as { level?: number } | undefined;
                const roleKey = String((p as { office_role?: string | null }).office_role ?? "");
                const roleLabel = roleKey ? (POLITICAL_ROLE_LABELS[roleKey] ?? roleKey) : "—";
                return (
                  <tr key={id} className="border-b border-[var(--psc-border)]/60">
                    <td className="px-2 py-1.5 font-medium text-[var(--psc-ink)]">
                      {String((p as { character_name?: string }).character_name ?? id.slice(0, 8))}
                    </td>
                    <td className="px-2 py-1.5">{String((p as { party?: string | null }).party ?? "—")}</td>
                    <td className="px-2 py-1.5 text-[var(--psc-ink)]">{roleLabel}</td>
                    <td className="px-2 py-1.5 font-mono tabular-nums">
                      {w ? `$${Number(w.balance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-[var(--psc-muted)]">
                      {w?.last_collected_at ? new Date(w.last_collected_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-2 py-1.5 font-mono tabular-nums">{pac != null ? Number(pac.level ?? 0) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Recent ledger (150)</h2>
        <p className="text-xs">Newest first. Hourly collects, transfers, party levies, and other kinds post here.</p>
        <div className="overflow-x-auto rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--psc-border)] text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
                <th className="px-2 py-2">When</th>
                <th className="px-2 py-2">User</th>
                <th className="px-2 py-2">Kind</th>
                <th className="px-2 py-2">Δ</th>
                <th className="px-2 py-2">Balance after</th>
                <th className="px-2 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {(ledger ?? []).map((row) => {
                const uid = (row as { wallet_user_id: string }).wallet_user_id;
                const prof = profileById.get(uid) as { character_name?: string } | undefined;
                const label = prof?.character_name?.trim() || uid.slice(0, 8);
                const detail = (row as { detail: unknown }).detail;
                const detailStr =
                  detail && typeof detail === "object" ? JSON.stringify(detail).slice(0, 160) : String(detail ?? "");
                return (
                  <tr key={(row as { id: string }).id} className="border-b border-[var(--psc-border)]/60 align-top">
                    <td className="px-2 py-1.5 whitespace-nowrap text-[var(--psc-muted)]">
                      {new Date((row as { created_at: string }).created_at).toLocaleString()}
                    </td>
                    <td className="px-2 py-1.5 text-[var(--psc-ink)]">{label}</td>
                    <td className="px-2 py-1.5 font-mono">{(row as { kind: string }).kind}</td>
                    <td className="px-2 py-1.5 font-mono tabular-nums">
                      ${Number((row as { delta: number }).delta).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-2 py-1.5 font-mono tabular-nums">
                      $
                      {Number((row as { balance_after: number }).balance_after).toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                    </td>
                    <td className="max-w-[320px] px-2 py-1.5 font-mono text-[10px] text-[var(--psc-muted)] break-all">
                      {detailStr}
                      {detailStr.length >= 160 ? "…" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
