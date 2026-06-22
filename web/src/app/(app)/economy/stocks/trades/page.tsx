import { redirect } from "next/navigation";
import { StockMarketNav } from "@/components/stock-market-nav";
import { StockTradesFeed, type StockTradeRow } from "@/components/stock-trades-feed";
import { getServerAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function StockTradesPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) return <div className="p-6 text-sm">Configure Supabase.</div>;
  if (!user) redirect("/login");

  const { data: trades } = await supabase
    .from("stock_trade_history")
    .select("id, trade_type, shares, price_per_share, total_value, created_at, buyer_id, seller_id, company:businesses(name, ticker_symbol)")
    .order("created_at", { ascending: false })
    .limit(100);

  const profileIds = new Set<string>();
  for (const t of trades ?? []) {
    if (t.buyer_id) profileIds.add(t.buyer_id as string);
    if (t.seller_id) profileIds.add(t.seller_id as string);
  }

  const { data: profiles } =
    profileIds.size > 0
      ? await supabase.from("profiles").select("id, character_name").in("id", [...profileIds])
      : { data: [] as { id: string; character_name: string | null }[] };

  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.character_name as string | null]));

  const normalized: StockTradeRow[] = (trades ?? []).map((t) => {
    const companyRaw = t.company as { name: string; ticker_symbol: string | null } | { name: string; ticker_symbol: string | null }[] | null;
    return {
      id: t.id as string,
      trade_type: t.trade_type as string,
      shares: Number(t.shares),
      price_per_share: Number(t.price_per_share),
      total_value: Number(t.total_value),
      created_at: t.created_at as string,
      company: Array.isArray(companyRaw) ? (companyRaw[0] ?? null) : companyRaw,
      buyer: t.buyer_id ? { character_name: nameById.get(t.buyer_id as string) ?? null } : null,
      seller: t.seller_id ? { character_name: nameById.get(t.seller_id as string) ?? null } : null,
    };
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Public stock trades</h1>
        <p className="mt-1 text-sm text-[var(--psc-muted)]">
          All buy and sell activity on the exchange. Trader names appear when disclosure rules apply.
        </p>
      </header>
      <StockMarketNav active="trades" />
      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
        <StockTradesFeed trades={normalized} />
      </section>
    </div>
  );
}
