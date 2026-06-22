import { notFound, redirect } from "next/navigation";
import { StockMarketNav } from "@/components/stock-market-nav";
import { CompanyLobbyPanel, type ShareholderRow } from "@/components/company-lobby-panel";
import { CompanyStockPanel, type CompanyDetail } from "@/components/company-stock-panel";
import { getServerAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ ticker: string }> };

export default async function CompanyTickerPage({ params }: Props) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase().replace(/[^A-Z]/g, "");
  if (symbol.length < 3) notFound();

  const { supabase, user } = await getServerAuth();
  if (!supabase) return <div className="p-6 text-sm">Configure Supabase.</div>;
  if (!user) redirect("/login");

  const { data: company } = await supabase
    .from("businesses")
    .select(
      "id, name, ticker_symbol, sector, description, primary_focus, strategy, price_per_share, valuation, total_shares, public_shares, founder_shares, shares_available, owner_user_id, ipo_date, created_at, revenue, growth_rate, market_share",
    )
    .eq("ticker_symbol", symbol)
    .maybeSingle();

  if (!company) notFound();

  const [{ data: holding }, { data: founder }, { data: sectorRank }, { data: shareholders }] = await Promise.all([
    supabase.from("stock_holdings").select("shares").eq("user_id", user.id).eq("business_id", company.id).maybeSingle(),
    supabase.from("profiles").select("character_name").eq("id", company.owner_user_id).maybeSingle(),
    supabase.rpc("company_sector_rank", { p_company_id: company.id }),
    supabase
      .from("stock_holdings")
      .select("user_id, shares, profile:profiles(character_name)")
      .eq("business_id", company.id)
      .gt("shares", 0)
      .neq("user_id", company.owner_user_id),
  ]);

  const detail: CompanyDetail = {
    id: company.id,
    name: company.name,
    ticker_symbol: company.ticker_symbol ?? symbol,
    sector: company.sector,
    description: company.description,
    primary_focus: company.primary_focus,
    strategy: company.strategy,
    price_per_share: Number(company.price_per_share),
    valuation: company.valuation != null ? Number(company.valuation) : null,
    total_shares: company.total_shares,
    public_shares: company.public_shares,
    founder_shares: company.founder_shares,
    shares_available: company.shares_available,
    owner_user_id: company.owner_user_id,
    ipo_date: company.ipo_date,
    created_at: company.created_at,
    founder_name: (founder as { character_name?: string | null } | null)?.character_name ?? null,
    revenue: Number(company.revenue ?? 0),
    growth_rate: Number(company.growth_rate ?? 0),
    market_share: Number(company.market_share ?? 0),
    sector_rank: sectorRank != null ? Number(sectorRank) : null,
  };

  return (
    <div className="space-y-8">
      <StockMarketNav active="market" />
      <CompanyStockPanel company={detail} userId={user.id} userShares={holding?.shares ?? 0} />
      {company.owner_user_id === user.id ? (
        <CompanyLobbyPanel
          companyId={company.id}
          companyName={company.name}
          tickerSymbol={detail.ticker_symbol}
          sector={company.sector}
          shareholders={(shareholders ?? []).map((row) => {
            const profileRaw = row.profile as { character_name: string | null } | { character_name: string | null }[] | null;
            const profile = Array.isArray(profileRaw) ? (profileRaw[0] ?? null) : profileRaw;
            const shares = Number(row.shares);
            return {
              user_id: row.user_id as string,
              character_name: profile?.character_name ?? null,
              shares,
              ownership_pct: company.total_shares > 0 ? (shares / company.total_shares) * 100 : 0,
            } satisfies ShareholderRow;
          })}
        />
      ) : null}
    </div>
  );
}
