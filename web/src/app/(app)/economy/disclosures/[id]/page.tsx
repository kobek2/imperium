import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { NavRouteButton } from "@/components/nav-route-button";
import {
  PoliticianStockDisclosurePanel,
  type PoliticianHoldingRow,
  type PoliticianTradeRow,
  type PoliticianVoteRow,
} from "@/components/politician-stock-disclosure-panel";
import { getServerAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function PoliticianDisclosurePage({ params }: Props) {
  const { id } = await params;
  const { supabase, user } = await getServerAuth();
  if (!supabase) return <div className="p-6 text-sm">Configure Supabase.</div>;
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, character_name, discord_username")
    .eq("id", id)
    .maybeSingle();

  if (!profile) notFound();

  const characterName =
    (profile.character_name ?? profile.discord_username ?? "Member").trim() || "Member";

  const [{ data: holdings }, { data: trades }, { data: votes }] = await Promise.all([
    supabase
      .from("stock_holdings")
      .select("business_id, shares, business:businesses(name, ticker_symbol, price_per_share, sector)")
      .eq("user_id", id)
      .gt("shares", 0),
    supabase
      .from("stock_trade_history")
      .select("id, trade_type, shares, price_per_share, total_value, created_at, company:businesses(name, ticker_symbol)")
      .or(`buyer_id.eq.${id},seller_id.eq.${id}`)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("bill_votes")
      .select("id, vote, chamber, created_at, bill_id, bill:bills(title, affected_sector, stock_market_effect)")
      .eq("voter_id", id)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const holdingRows: PoliticianHoldingRow[] = (holdings ?? []).map((h) => {
    const bizRaw = h.business as
      | { name: string; ticker_symbol: string | null; price_per_share: number; sector: string }
      | { name: string; ticker_symbol: string | null; price_per_share: number; sector: string }[]
      | null;
    const biz = Array.isArray(bizRaw) ? (bizRaw[0] ?? null) : bizRaw;
    return {
      business_id: h.business_id as string,
      shares: Number(h.shares),
      name: biz?.name ?? "Unknown",
      ticker_symbol: biz?.ticker_symbol ?? null,
      price_per_share: Number(biz?.price_per_share ?? 0),
      sector: biz?.sector ?? "",
    };
  });

  const tradeRows: PoliticianTradeRow[] = (trades ?? []).map((t) => {
    const companyRaw = t.company as { name: string; ticker_symbol: string | null } | { name: string; ticker_symbol: string | null }[] | null;
    const company = Array.isArray(companyRaw) ? (companyRaw[0] ?? null) : companyRaw;
    return {
      id: t.id as string,
      trade_type: t.trade_type as string,
      shares: Number(t.shares),
      price_per_share: Number(t.price_per_share),
      total_value: Number(t.total_value),
      created_at: t.created_at as string,
      company_name: company?.name ?? "Unknown",
      ticker_symbol: company?.ticker_symbol ?? null,
    };
  });

  const voteRows: PoliticianVoteRow[] = (votes ?? []).map((v) => {
    const billRaw = v.bill as
      | { title: string; affected_sector: string | null; stock_market_effect: number | null }
      | { title: string; affected_sector: string | null; stock_market_effect: number | null }[]
      | null;
    const bill = Array.isArray(billRaw) ? (billRaw[0] ?? null) : billRaw;
    return {
      id: v.id as string,
      vote: v.vote as string,
      chamber: v.chamber as string,
      created_at: v.created_at as string,
      bill_id: v.bill_id as string,
      bill_title: bill?.title ?? "Bill",
      affected_sector: bill?.affected_sector ?? null,
      stock_market_effect: bill?.stock_market_effect != null ? Number(bill.stock_market_effect) : null,
    };
  });

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Stock & vote disclosure</h1>
          <p className="mt-1 text-sm text-[var(--psc-muted)]">
            <Link href={`/profile/${id}`} className="font-semibold text-[var(--psc-ink)] underline">
              {characterName}
            </Link>
            — holdings, trades, and legislative votes on the public record.
          </p>
        </div>
        <NavRouteButton href="/economy/stocks">Stock market</NavRouteButton>
      </header>
      <PoliticianStockDisclosurePanel
        characterName={characterName}
        holdings={holdingRows}
        trades={tradeRows}
        votes={voteRows}
      />
    </div>
  );
}
