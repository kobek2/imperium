import { redirect } from "next/navigation";
import { StockMarketNav } from "@/components/stock-market-nav";
import { MarketEventsFeed, type MarketEventRow } from "@/components/market-events-feed";
import { getServerAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MarketEventsPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) return <div className="p-6 text-sm">Configure Supabase.</div>;
  if (!user) redirect("/login");

  const { data: events } = await supabase
    .from("market_events")
    .select("id, headline, affected_sector, sector_effect_pct, created_at, bill_id")
    .order("created_at", { ascending: false })
    .limit(50);

  const eventIds = (events ?? []).map((e) => e.id as string);
  const { data: companyRows } =
    eventIds.length > 0
      ? await supabase
          .from("market_event_companies")
          .select("market_event_id, company_name, ticker_symbol, price_before, price_after")
          .in("market_event_id", eventIds)
      : { data: [] as Array<Record<string, unknown>> };

  const companiesByEvent = new Map<string, MarketEventRow["companies"]>();
  for (const row of companyRows ?? []) {
    const eventId = row.market_event_id as string;
    const list = companiesByEvent.get(eventId) ?? [];
    list.push({
      company_name: row.company_name as string,
      ticker_symbol: (row.ticker_symbol as string | null) ?? null,
      price_before: Number(row.price_before),
      price_after: Number(row.price_after),
    });
    companiesByEvent.set(eventId, list);
  }

  const normalized: MarketEventRow[] = (events ?? []).map((e) => ({
    id: e.id as string,
    headline: e.headline as string,
    affected_sector: e.affected_sector as string,
    sector_effect_pct: Number(e.sector_effect_pct),
    created_at: e.created_at as string,
    bill_id: (e.bill_id as string | null) ?? null,
    companies: companiesByEvent.get(e.id as string) ?? [],
  }));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Market events</h1>
        <p className="mt-1 text-sm text-[var(--psc-muted)]">
          Public record when enacted legislation moves sector stock prices.
        </p>
      </header>
      <StockMarketNav active="market-events" />
      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
        <MarketEventsFeed events={normalized} />
      </section>
    </div>
  );
}
