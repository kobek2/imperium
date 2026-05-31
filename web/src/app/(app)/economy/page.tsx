import { redirect } from "next/navigation";
import { NavRouteButton } from "@/components/nav-route-button";
import { getServerAuth } from "@/lib/supabase/server";
import { OrientationTourPanelEconomy } from "@/components/orientation-tour-panel";
import { EconomyDashboard } from "./economy-dashboard";
import { fetchEconomyLedgerWithDisplayNames } from "@/lib/economy-ledger-view";

export default async function EconomyPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Configure Supabase to use the economy.
      </div>
    );
  }

  if (!user) redirect("/login");

  const [
    { data: wallet },
    { data: pac },
    { data: invRows },
    { data: meProf },
    { data: activeFy },
  ] = await Promise.all([
    supabase.from("economy_wallets").select("balance, last_collected_at").eq("user_id", user.id).maybeSingle(),
    supabase.from("economy_pacs").select("level").eq("user_id", user.id).maybeSingle(),
    supabase.from("economy_inventory").select("sku, quantity").eq("user_id", user.id),
    supabase
      .from("profiles")
      .select("party, orientation_completed_at, orientation_step")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("rp_fiscal_years")
      .select("id, appropriations_act_bill_id, economy_activity_frozen")
      .eq("status", "active")
      .maybeSingle(),
  ]);

  const allowFederalBudget = false;

  const fyRow = activeFy as {
    id?: string;
    appropriations_act_bill_id?: string | null;
    economy_activity_frozen?: boolean | null;
  } | null;

  /** Matches server `_economy_require_active_budget`: only manual freeze blocks wallet activity. */
  const manualShutdown = Boolean(fyRow?.economy_activity_frozen);
  const economyFrozen = manualShutdown;

  let federalEstimatedTax: number | null = null;
  const { data: taxRpcData, error: taxRpcErr } = await supabase.rpc("fiscal_estimate_ytd_income_tax");
  if (!taxRpcErr && taxRpcData && typeof taxRpcData === "object") {
    const d = taxRpcData as Record<string, unknown>;
    federalEstimatedTax = Number(d.estimated_tax ?? 0);
  }

  const me = meProf as {
    party?: string | null;
    orientation_completed_at?: string | null;
    orientation_step?: number | null;
  } | null;
  const aff = String(me?.party ?? "").trim();
  const treasuryPartyKey = aff === "democrat" || aff === "republican" ? aff : null;
  let taxAccount: {
    assessed_tax?: number;
    paid_amount?: number;
    outstanding_amount?: number;
    total_penalties?: number;
    due_at?: string;
    status?: string;
  } | null = null;
  const { data: taxLedger, error: taxLedgerErr } = await supabase.rpc("fiscal_my_tax_ledger_account");
  if (!taxLedgerErr && taxLedger && typeof taxLedger === "object") {
    const acc = (taxLedger as { account?: Record<string, unknown> | null }).account;
    if (acc && typeof acc === "object") {
      taxAccount = {
        assessed_tax: Number(acc.assessed_tax ?? 0),
        paid_amount: Number(acc.paid_amount ?? 0),
        outstanding_amount: Number(acc.outstanding_amount ?? 0),
        total_penalties: Number(acc.total_penalties ?? 0),
        due_at: acc.due_at != null ? String(acc.due_at) : undefined,
        status: acc.status != null ? String(acc.status) : undefined,
      };
    }
  }

  const inventory =
    (invRows ?? []).find((r) => (r as { sku: string }).sku === "campaign_ad") ?? null;

  const recentLedger = await fetchEconomyLedgerWithDisplayNames(supabase, 40);

  const inTour = !me?.orientation_completed_at;
  const onStep2 = inTour && (me?.orientation_step ?? 1) === 2;
  const { count: economyLedgerCount } = await supabase
    .from("economy_ledger")
    .select("*", { count: "exact", head: true })
    .eq("wallet_user_id", user.id);
  const economyTourCanAdvance = (economyLedgerCount ?? 0) > 0;
  const orientationEconomyBlock = onStep2 ? (
    <OrientationTourPanelEconomy canAdvance={economyTourCanAdvance} />
  ) : null;

  return (
    <div className="space-y-8">
      {orientationEconomyBlock}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Economy</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {allowFederalBudget ? (
            <NavRouteButton href="/economy/federal">Federal budget</NavRouteButton>
          ) : null}
          <NavRouteButton href="/economy/leaderboard">Leaderboard</NavRouteButton>
        </div>
      </header>

      <EconomyDashboard
        wallet={wallet as { balance: number; last_collected_at: string } | null}
        pac={pac as { level: number } | null}
        inventory={inventory as { sku: string; quantity: number } | null}
        recentLedger={recentLedger}
        treasuryPartyKey={treasuryPartyKey}
        economyFrozen={economyFrozen}
        federalEstimatedTax={federalEstimatedTax}
        taxAccount={
          (taxAccount as {
            assessed_tax?: number;
            paid_amount?: number;
            outstanding_amount?: number;
            total_penalties?: number;
            due_at?: string;
            status?: string;
          } | null) ?? null
        }
        showFederalBudgetLink={false}
      />
    </div>
  );
}
