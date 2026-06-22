import { redirect } from "next/navigation";
import { NavRouteButton } from "@/components/nav-route-button";
import { StockMarketNav } from "@/components/stock-market-nav";
import { StockMarketPanel } from "@/components/stock-market-panel";
import type { PriceHistoryPoint } from "@/components/stock-market-chart";
import { getServerAuth } from "@/lib/supabase/server";

export default async function EconomyStocksPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) return <div className="p-6 text-sm">Configure Supabase.</div>;
  if (!user) redirect("/login");

  const [{ data: businesses }, { data: holdings }, { data: historyRows }] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, ticker_symbol, sector, price_per_share, shares_available, total_shares, owner_user_id, valuation, market_share")
      .order("name"),
    supabase
      .from("stock_holdings")
      .select("business_id, shares, business:businesses(name, ticker_symbol, sector, price_per_share, total_shares)")
      .eq("user_id", user.id)
      .gt("shares", 0),
    supabase
      .from("business_price_history")
      .select("business_id, price_per_share, recorded_at, business:businesses(name)")
      .order("recorded_at", { ascending: true })
      .limit(500),
  ]);

  const history: PriceHistoryPoint[] = (historyRows ?? []).map((row) => {
    const biz = row.business as { name?: string } | { name?: string }[] | null;
    const name = Array.isArray(biz) ? biz[0]?.name : biz?.name;
    return {
      business_id: row.business_id,
      business_name: name ?? "",
      price_per_share: Number(row.price_per_share),
      recorded_at: row.recorded_at,
    };
  });

  const normalizedHoldings = (holdings ?? []).map((h) => {
    const raw = h.business as
      | { name: string; ticker_symbol: string | null; sector: string; price_per_share: number; total_shares: number }
      | { name: string; ticker_symbol: string | null; sector: string; price_per_share: number; total_shares: number }[]
      | null;
    const biz = Array.isArray(raw) ? (raw[0] ?? null) : raw;
    return { business_id: h.business_id, shares: h.shares, business: biz };
  });

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Stock market</h1>
          <p className="mt-1 text-sm text-[var(--psc-muted)]">
            Trade public company shares. Incorporate a company or browse listed tickers.
          </p>
        </div>
        <NavRouteButton href="/economy">Economy</NavRouteButton>
      </header>
      <StockMarketNav active="market" />
      <StockMarketPanel
        businesses={(businesses ?? []) as Parameters<typeof StockMarketPanel>[0]["businesses"]}
        holdings={normalizedHoldings}
        history={history}
        userId={user.id}
      />
    </div>
  );
}
