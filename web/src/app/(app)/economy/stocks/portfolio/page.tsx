import { redirect } from "next/navigation";
import { StockMarketNav } from "@/components/stock-market-nav";
import { StockPortfolioPanel, type PortfolioRow } from "@/components/stock-portfolio-panel";
import { getServerAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function StockPortfolioPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) return <div className="p-6 text-sm">Configure Supabase.</div>;
  if (!user) redirect("/login");

  const [{ data: holdings }, { data: buyTrades }] = await Promise.all([
    supabase
      .from("stock_holdings")
      .select("business_id, shares, business:businesses(name, ticker_symbol, price_per_share)")
      .eq("user_id", user.id)
      .gt("shares", 0),
    supabase
      .from("stock_trade_history")
      .select("company_id, shares, total_value, price_per_share")
      .eq("buyer_id", user.id)
      .eq("trade_type", "buy"),
  ]);

  const costByCompany = new Map<string, { shares: number; cost: number }>();
  for (const t of buyTrades ?? []) {
    const id = t.company_id as string;
    const prev = costByCompany.get(id) ?? { shares: 0, cost: 0 };
    costByCompany.set(id, {
      shares: prev.shares + Number(t.shares),
      cost: prev.cost + Number(t.total_value),
    });
  }

  const rows: PortfolioRow[] = (holdings ?? []).map((h) => {
    const raw = h.business as
      | { name: string; ticker_symbol: string | null; price_per_share: number }
      | { name: string; ticker_symbol: string | null; price_per_share: number }[]
      | null;
    const biz = Array.isArray(raw) ? (raw[0] ?? null) : raw;
    const cost = costByCompany.get(h.business_id);
    const avgCost =
      cost && cost.shares > 0 ? cost.cost / cost.shares : Number(biz?.price_per_share ?? 0);
    return {
      business_id: h.business_id,
      shares: h.shares,
      avg_cost: avgCost,
      current_price: Number(biz?.price_per_share ?? 0),
      name: biz?.name ?? "Unknown",
      ticker_symbol: biz?.ticker_symbol ?? null,
    };
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <p className="mt-1 text-sm text-[var(--psc-muted)]">Your public company holdings and gain/loss.</p>
      </header>
      <StockMarketNav active="portfolio" />
      <StockPortfolioPanel rows={rows} />
    </div>
  );
}
