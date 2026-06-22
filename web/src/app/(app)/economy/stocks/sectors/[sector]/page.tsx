import { notFound, redirect } from "next/navigation";
import { SectorDetailPanel, type SectorCompanyRow } from "@/components/sector-market-panel";
import { StockMarketNav } from "@/components/stock-market-nav";
import { BUSINESS_SECTORS } from "@/lib/economy-config";
import { sectorLabel } from "@/lib/stock-market";
import { getServerAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ sector: string }> };

export default async function StockSectorDetailPage({ params }: Props) {
  const { sector: sectorKey } = await params;
  const sector = BUSINESS_SECTORS.find((s) => s.key === sectorKey)?.key;
  if (!sector) notFound();

  const { supabase, user } = await getServerAuth();
  if (!supabase) return <div className="p-6 text-sm">Configure Supabase.</div>;
  if (!user) redirect("/login");

  const [{ data: stat }, { data: companies }] = await Promise.all([
    supabase
      .from("sector_market_stats")
      .select("total_sector_revenue, market_concentration")
      .eq("sector", sector)
      .maybeSingle(),
    supabase
      .from("businesses")
      .select("id, name, ticker_symbol, revenue, market_share, growth_rate, strategy")
      .eq("sector", sector)
      .gt("revenue", 0)
      .order("revenue", { ascending: false })
      .order("created_at", { ascending: true }),
  ]);

  const rows: SectorCompanyRow[] = (companies ?? []).map((c, index) => ({
    id: c.id as string,
    name: c.name as string,
    ticker_symbol: (c.ticker_symbol as string | null) ?? null,
    revenue: Number(c.revenue),
    market_share: Number(c.market_share),
    growth_rate: Number(c.growth_rate),
    strategy: (c.strategy as string | null) ?? null,
    rank: index + 1,
  }));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">{sectorLabel(sector)} industry</h1>
        <p className="mt-1 text-sm text-[var(--psc-muted)]">
          Market share and revenue rankings for companies in this sector.
        </p>
      </header>
      <StockMarketNav active="sectors" />
      <SectorDetailPanel
        sector={sector}
        totalRevenue={Number(stat?.total_sector_revenue ?? 0)}
        companies={rows}
      />
    </div>
  );
}
