import { redirect } from "next/navigation";
import { SectorOverviewPanel, type SectorOverviewRow } from "@/components/sector-market-panel";
import { StockMarketNav } from "@/components/stock-market-nav";
import { BUSINESS_SECTORS } from "@/lib/economy-config";
import { getServerAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function StockSectorsPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) return <div className="p-6 text-sm">Configure Supabase.</div>;
  if (!user) redirect("/login");

  const [{ data: stats }, { data: companies }] = await Promise.all([
    supabase
      .from("sector_market_stats")
      .select("sector, total_sector_revenue, market_concentration, largest_company_id"),
    supabase.from("businesses").select("id, sector, name, ticker_symbol, revenue").gt("revenue", 0),
  ]);

  const statsBySector = new Map((stats ?? []).map((s) => [s.sector as string, s]));
  const countBySector = new Map<string, number>();

  for (const c of companies ?? []) {
    const sector = c.sector as string;
    countBySector.set(sector, (countBySector.get(sector) ?? 0) + 1);
  }

  const leaderIds = [...new Set((stats ?? []).map((s) => s.largest_company_id).filter(Boolean))] as string[];
  const { data: leaders } =
    leaderIds.length > 0
      ? await supabase.from("businesses").select("id, sector, name, ticker_symbol").in("id", leaderIds)
      : { data: [] as Array<{ id: string; sector: string; name: string; ticker_symbol: string | null }> };

  const leaderBySector = new Map(
    (leaders ?? []).map((l) => [
      l.sector as string,
      { name: l.name as string, ticker: (l.ticker_symbol as string | null) ?? null },
    ]),
  );

  const rows: SectorOverviewRow[] = BUSINESS_SECTORS.map((s) => {
    const stat = statsBySector.get(s.key);
    const leader = leaderBySector.get(s.key);
    return {
      sector: s.key,
      total_sector_revenue: Number(stat?.total_sector_revenue ?? 0),
      market_concentration: Number(stat?.market_concentration ?? 0),
      company_count: countBySector.get(s.key) ?? 0,
      leader_name: leader?.name ?? null,
      leader_ticker: leader?.ticker ?? null,
    };
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Sector markets</h1>
        <p className="mt-1 text-sm text-[var(--psc-muted)]">
          Industry competition and market share across public companies.
        </p>
      </header>
      <StockMarketNav active="sectors" />
      <SectorOverviewPanel sectors={rows} />
    </div>
  );
}
