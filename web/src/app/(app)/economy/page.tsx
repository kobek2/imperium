import { redirect } from "next/navigation";
import { NavRouteButton } from "@/components/nav-route-button";
import { getServerAuth } from "@/lib/supabase/server";
import { OrientationTourPanelEconomy } from "@/components/orientation-tour-panel";
import { FinancesDashboard } from "./economy-dashboard";
import { fetchEconomyLedgerWithDisplayNames } from "@/lib/economy-ledger-view";
import { sumCampaignAdInventory } from "@/lib/campaign-ad-inventory";

export const dynamic = "force-dynamic";

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
    { data: meProf },
    { data: activeFy },
    { data: taxRpcData },
    { data: taxLedger },
    { data: inventoryRows },
    recentLedger,
  ] = await Promise.all([
    supabase.from("economy_wallets").select("balance, last_collected_at").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("profiles")
      .select("party, character_name, orientation_completed_at, orientation_step")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("rp_fiscal_years").select("economy_activity_frozen").eq("status", "active").maybeSingle(),
    supabase.rpc("fiscal_estimate_ytd_income_tax"),
    supabase.rpc("fiscal_my_tax_ledger_account"),
    supabase.from("economy_inventory").select("sku, quantity").eq("user_id", user.id),
    fetchEconomyLedgerWithDisplayNames(supabase, 40, user.id),
  ]);

  const economyFrozen = Boolean((activeFy as { economy_activity_frozen?: boolean } | null)?.economy_activity_frozen);

  let federalEstimatedTax: number | null = null;
  if (taxRpcData && typeof taxRpcData === "object") {
    federalEstimatedTax = Number((taxRpcData as Record<string, unknown>).estimated_tax ?? 0);
  }

  const me = meProf as {
    party?: string | null;
    character_name?: string | null;
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
  if (taxLedger && typeof taxLedger === "object") {
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

  const inTour = !me?.orientation_completed_at;
  const onStep2 = inTour && (me?.orientation_step ?? 1) === 2;
  const adsInventory = sumCampaignAdInventory(inventoryRows ?? []);

  return (
    <div className="space-y-8">
      {onStep2 ? <OrientationTourPanelEconomy canAdvance={recentLedger.length > 0} /> : null}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Economy</h1>
          <p className="mt-1 text-sm text-[var(--psc-muted)]">
            Hourly salary, party treasury, stocks, campaign ads, and city income.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NavRouteButton href="/economy/stocks">Stocks</NavRouteButton>
          <NavRouteButton href="/economy/leaderboard">Leaderboard</NavRouteButton>
        </div>
      </header>

      <FinancesDashboard
        wallet={wallet as { balance: number; last_collected_at: string } | null}
        recentLedger={recentLedger}
        treasuryPartyKey={treasuryPartyKey}
        economyFrozen={economyFrozen}
        federalEstimatedTax={federalEstimatedTax}
        taxAccount={taxAccount}
        showFederalBudgetLink={false}
        adsInventory={adsInventory}
      />
    </div>
  );
}
