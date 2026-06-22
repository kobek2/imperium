import Link from "next/link";
import { formatUsd } from "@/lib/stock-market";

export type StockTradeRow = {
  id: string;
  trade_type: string;
  shares: number;
  price_per_share: number;
  total_value: number;
  created_at: string;
  company?: { name: string; ticker_symbol: string | null } | null;
  buyer?: { character_name: string | null } | null;
  seller?: { character_name: string | null } | null;
};

export function StockTradesFeed({ trades }: { trades: StockTradeRow[] }) {
  if (trades.length === 0) {
    return <p className="text-sm text-[var(--psc-muted)]">No trades recorded yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--psc-border)] text-xs text-[var(--psc-muted)]">
            <th className="py-2 pr-3 font-medium">Time</th>
            <th className="py-2 pr-3 font-medium">Ticker</th>
            <th className="py-2 pr-3 font-medium">Type</th>
            <th className="py-2 pr-3 font-medium">Shares</th>
            <th className="py-2 pr-3 font-medium">Price</th>
            <th className="py-2 pr-3 font-medium">Total</th>
            <th className="py-2 font-medium">Trader</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const ticker = t.company?.ticker_symbol;
            const isBuy = t.trade_type === "buy";
            const trader = isBuy ? t.buyer?.character_name : t.seller?.character_name;
            return (
              <tr key={t.id} className="border-b border-[var(--psc-border)] last:border-0">
                <td className="py-2.5 pr-3 text-xs text-[var(--psc-muted)] whitespace-nowrap">
                  {new Date(t.created_at).toLocaleString()}
                </td>
                <td className="py-2.5 pr-3 font-mono">
                  {ticker ? (
                    <Link href={`/economy/stocks/${ticker}`} className="hover:underline">
                      {ticker}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={`py-2.5 pr-3 font-semibold uppercase ${isBuy ? "text-emerald-700" : "text-rose-700"}`}>
                  {t.trade_type}
                </td>
                <td className="py-2.5 pr-3 font-mono">{t.shares.toLocaleString()}</td>
                <td className="py-2.5 pr-3 font-mono">{formatUsd(Number(t.price_per_share), { decimals: 2 })}</td>
                <td className="py-2.5 pr-3 font-mono">{formatUsd(Number(t.total_value))}</td>
                <td className="py-2.5 text-xs">
                  {trader ?? <span className="text-[var(--psc-muted)]">Public disclosure rules apply</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
