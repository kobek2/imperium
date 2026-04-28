import { redirect } from "next/navigation";
import { NavRouteButton } from "@/components/nav-route-button";
import { getServerAuth } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";
import { isPresident } from "@/lib/president";
import { EconomyDashboard } from "./economy-dashboard";

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
    { data: ledger },
    { data: meProf },
    { data: activeFy },
    pres,
    isAdmin,
  ] = await Promise.all([
    supabase.from("economy_wallets").select("balance, last_collected_at").eq("user_id", user.id).maybeSingle(),
    supabase.from("economy_pacs").select("level").eq("user_id", user.id).maybeSingle(),
    supabase.from("economy_inventory").select("sku, quantity").eq("user_id", user.id),
    supabase
      .from("economy_ledger")
      .select("id, wallet_user_id, delta, kind, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(40),
    supabase.from("profiles").select("party").eq("id", user.id).maybeSingle(),
    supabase
      .from("rp_fiscal_years")
      .select("id, appropriation_deadline_at, appropriations_act_bill_id")
      .eq("status", "active")
      .maybeSingle(),
    isPresident(supabase, user.id),
    getIsAdmin(),
  ]);

  await supabase.rpc("fiscal_start_appropriation_clock_if_president_seated");

  const fyRow = activeFy as {
    id?: string;
    appropriation_deadline_at?: string | null;
    appropriations_act_bill_id?: string | null;
  } | null;

  const governmentShutdown = Boolean(
    fyRow?.appropriation_deadline_at &&
      !fyRow?.appropriations_act_bill_id &&
      new Date(fyRow.appropriation_deadline_at) < new Date(),
  );

  let economyFrozen = true;
  if (fyRow?.id) {
    const { data: fyBudget } = await supabase
      .from("federal_budgets")
      .select("status")
      .eq("fiscal_year_id", fyRow.id)
      .maybeSingle();
    economyFrozen =
      governmentShutdown || !fyBudget || (fyBudget as { status: string }).status !== "submitted";
  }

  let federalEstimatedTax: number | null = null;
  const { data: taxRpcData, error: taxRpcErr } = await supabase.rpc("fiscal_estimate_ytd_income_tax");
  if (!taxRpcErr && taxRpcData && typeof taxRpcData === "object") {
    const d = taxRpcData as Record<string, unknown>;
    federalEstimatedTax = Number(d.estimated_tax ?? 0);
  }

  const aff = String((meProf as { party?: string } | null)?.party ?? "").trim();
  const treasuryPartyKey = aff === "democrat" || aff === "republican" ? aff : null;
  const { data: taxAccount } = await supabase
    .from("fiscal_tax_accounts")
    .select("assessed_tax, paid_amount, outstanding_amount, total_penalties, due_at, status")
    .eq("user_id", user.id)
    .order("assessed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const inventory =
    (invRows ?? []).find((r) => (r as { sku: string }).sku === "campaign_ad") ?? null;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Economy</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <NavRouteButton href="/national-metrics">National metrics</NavRouteButton>
          {pres || isAdmin ? <NavRouteButton href="/economy/federal">Federal budget</NavRouteButton> : null}
          <NavRouteButton href="/economy/leaderboard">Leaderboard</NavRouteButton>
        </div>
      </header>

      <EconomyDashboard
        wallet={wallet as { balance: number; last_collected_at: string } | null}
        pac={pac as { level: number } | null}
        inventory={inventory as { sku: string; quantity: number } | null}
        recentLedger={(ledger ?? []) as never}
        viewerId={user.id}
        treasuryPartyKey={treasuryPartyKey}
        economyFrozen={economyFrozen}
        governmentShutdown={governmentShutdown}
        appropriationDeadlineAt={fyRow?.appropriation_deadline_at ?? null}
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
        showFederalBudgetLink={pres || isAdmin}
      />
    </div>
  );
}
