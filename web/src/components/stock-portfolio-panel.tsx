import Link from "next/link";
import { companyDisplayName, formatUsd } from "@/lib/stock-market";

export type PortfolioRow = {
  business_id: string;
  shares: number;
  avg_cost: number;
  current_price: number;
  name: string;
  ticker_symbol: string | null;
};

export function StockPortfolioPanel({ rows }: { rows: PortfolioRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--psc-muted)]">
        No stock holdings yet.{" "}
        <Link href="/economy/stocks" className="underline">
          Browse the market
        </Link>
        .
      </p>
    );
  }

  const totalValue = rows.reduce((s, r) => s + r.shares * r.current_price, 0);
  const totalCost = rows.reduce((s, r) => s + r.shares * r.avg_cost, 0);
  const totalGain = totalValue - totalCost;

  return (
    <div className="space-y-6">
      <dl className="grid gap-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-[var(--psc-muted)]">Portfolio value</dt>
          <dd className="font-mono text-lg">{formatUsd(totalValue)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--psc-muted)]">Cost basis</dt>
          <dd className="font-mono text-lg">{formatUsd(totalCost)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--psc-muted)]">Total gain/loss</dt>
          <dd className={`font-mono text-lg ${totalGain >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
            {totalGain >= 0 ? "+" : ""}
            {formatUsd(totalGain)}
          </dd>
        </div>
      </dl>

      <ul className="divide-y divide-[var(--psc-border)] rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]">
        {rows.map((r) => {
          const currentValue = r.shares * r.current_price;
          const costBasis = r.shares * r.avg_cost;
          const gain = currentValue - costBasis;
          return (
            <li key={r.business_id} className="p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  {r.ticker_symbol ? (
                    <Link href={`/economy/stocks/${r.ticker_symbol}`} className="font-semibold hover:underline">
                      {companyDisplayName(r.name, r.ticker_symbol)}
                    </Link>
                  ) : (
                    <p className="font-semibold">{r.name}</p>
                  )}
                  <p className="mt-1 text-xs text-[var(--psc-muted)]">{r.shares.toLocaleString()} shares</p>
                </div>
                <div className="text-right font-mono text-xs sm:text-sm">
                  <p>{formatUsd(currentValue)}</p>
                  <p className={`mt-1 ${gain >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {gain >= 0 ? "+" : ""}
                    {formatUsd(gain)}
                  </p>
                </div>
              </div>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--psc-muted)]">Avg purchase price</dt>
                  <dd className="font-mono">{formatUsd(r.avg_cost, { decimals: 2 })}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--psc-muted)]">Current price</dt>
                  <dd className="font-mono">{formatUsd(r.current_price, { decimals: 2 })}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
