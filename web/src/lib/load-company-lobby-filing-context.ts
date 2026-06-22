import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyLobbyOfferRow } from "@/app/actions/economy";

export type OwnedCompanyForFiling = {
  id: string;
  name: string;
  ticker_symbol: string | null;
  sector: string;
};

export async function loadCompanyLobbyFilingContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ lobbyOffers: CompanyLobbyOfferRow[]; ownedCompanies: OwnedCompanyForFiling[] }> {
  const [{ data: lobbyRows }, { data: ownedRows }] = await Promise.all([
    supabase
      .from("company_lobby_offers")
      .select(
        "id, company_id, owner_user_id, recipient_user_id, amount, measure_key, affected_sector, stock_market_effect, bill_title, bill_content_md, message, status, company:businesses(name, ticker_symbol)",
      )
      .eq("recipient_user_id", userId)
      .eq("status", "funded")
      .order("created_at", { ascending: false }),
    supabase
      .from("businesses")
      .select("id, name, ticker_symbol, sector")
      .eq("owner_user_id", userId)
      .order("name"),
  ]);

  const lobbyOffers: CompanyLobbyOfferRow[] = (lobbyRows ?? []).map((row) => {
    const companyRaw = row.company as { name: string; ticker_symbol: string | null } | { name: string; ticker_symbol: string | null }[] | null;
    const company = Array.isArray(companyRaw) ? (companyRaw[0] ?? null) : companyRaw;
    return {
      id: row.id as string,
      company_id: row.company_id as string,
      company_name: company?.name ?? "Company",
      ticker_symbol: company?.ticker_symbol ?? null,
      owner_user_id: row.owner_user_id as string,
      recipient_user_id: row.recipient_user_id as string,
      amount: Number(row.amount),
      measure_key: row.measure_key as string,
      affected_sector: row.affected_sector as string,
      stock_market_effect: Number(row.stock_market_effect),
      bill_title: row.bill_title as string,
      bill_content_md: row.bill_content_md as string,
      message: (row.message as string | null) ?? null,
      status: row.status as string,
    };
  });

  const ownedCompanies: OwnedCompanyForFiling[] = (ownedRows ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    ticker_symbol: (row.ticker_symbol as string | null) ?? null,
    sector: row.sector as string,
  }));

  return { lobbyOffers, ownedCompanies };
}
