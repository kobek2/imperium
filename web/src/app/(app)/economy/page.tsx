import { redirect } from "next/navigation";
import { NavRouteButton } from "@/components/nav-route-button";
import { getServerAuth } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";
import { getStaffAccess } from "@/lib/staff-access";
import { isPresident } from "@/lib/president";
import { OrientationTourPanelEconomy } from "@/components/orientation-tour-panel";
import { EconomyDashboard } from "./economy-dashboard";

function ledgerRelatedUserId(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  const raw = d.to ?? d.from ?? d.from_officer ?? null;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

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
    staffAccess,
  ] = await Promise.all([
    supabase.from("economy_wallets").select("balance, last_collected_at").eq("user_id", user.id).maybeSingle(),
    supabase.from("economy_pacs").select("level").eq("user_id", user.id).maybeSingle(),
    supabase.from("economy_inventory").select("sku, quantity").eq("user_id", user.id),
    supabase
      .from("economy_ledger")
      .select("id, wallet_user_id, delta, kind, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(40),
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
    isPresident(supabase, user.id),
    getIsAdmin(),
    getStaffAccess(),
  ]);

  await supabase.rpc("fiscal_start_appropriation_clock_if_president_seated");

  const allowFederalBudget =
    pres ||
    isAdmin ||
    Boolean(staffAccess?.hasFullStaff) ||
    Boolean(staffAccess?.roleKeys.includes("secretary_of_treasury"));

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
  const { data: taxAccount } = await supabase
    .from("fiscal_tax_accounts")
    .select("assessed_tax, paid_amount, outstanding_amount, total_penalties, due_at, status")
    .eq("user_id", user.id)
    .order("assessed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const inventory =
    (invRows ?? []).find((r) => (r as { sku: string }).sku === "campaign_ad") ?? null;

  const ledgerRows = (ledger ?? []) as Array<{
    id: string;
    wallet_user_id: string;
    delta: number;
    kind: string;
    detail: unknown;
    created_at: string;
  }>;
  const ledgerProfileIds = new Set<string>();
  for (const row of ledgerRows) {
    ledgerProfileIds.add(row.wallet_user_id);
    const related = ledgerRelatedUserId(row.detail);
    if (related) ledgerProfileIds.add(related);
  }
  const { data: ledgerProfiles } = ledgerProfileIds.size
    ? await supabase
        .from("profiles")
        .select("id, character_name, discord_username")
        .in("id", [...ledgerProfileIds])
    : { data: [] as Array<{ id: string; character_name: string | null; discord_username: string | null }> };
  const ledgerProfileById = new Map(
    (ledgerProfiles ?? []).map((p) => [
      p.id as string,
      ((p.character_name as string | null)?.trim() || (p.discord_username as string | null)?.trim() || (p.id as string).slice(0, 8)),
    ]),
  );
  const recentLedger = ledgerRows.map((row) => {
    const relatedUserId = ledgerRelatedUserId(row.detail);
    return {
      ...row,
      walletName: ledgerProfileById.get(row.wallet_user_id) ?? row.wallet_user_id.slice(0, 8),
      relatedName: relatedUserId ? ledgerProfileById.get(relatedUserId) ?? relatedUserId.slice(0, 8) : null,
    };
  });

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
        showFederalBudgetLink={pres || isAdmin || Boolean(staffAccess?.hasFullStaff)}
      />
    </div>
  );
}
