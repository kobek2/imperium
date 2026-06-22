"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buyStock } from "@/app/actions/economy";
import { StockMarketChart, type PriceHistoryPoint } from "@/components/stock-market-chart";
import { companyDisplayName, formatMarketSharePct, formatUsd, sectorLabel } from "@/lib/stock-market";

export type BusinessRow = {
  id: string;
  name: string;
  ticker_symbol: string | null;
  sector: string;
  price_per_share: number;
  shares_available: number;
  total_shares: number;
  owner_user_id: string;
  valuation: number | null;
  market_share: number;
};

export type HoldingRow = {
  business_id: string;
  shares: number;
  business?: {
    name: string;
    ticker_symbol: string | null;
    sector: string;
    price_per_share: number;
    total_shares: number;
  } | null;
};

function pctChange(history: PriceHistoryPoint[], businessId: string, currentPrice: number): number | null {
  const points = history
    .filter((h) => h.business_id === businessId)
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
  const start = Number(points[0]?.price_per_share ?? 0);
  if (start <= 0) return null;
  return ((currentPrice - start) / start) * 100;
}

export function StockMarketPanel({
  businesses,
  holdings,
  history,
  userId,
}: {
  businesses: BusinessRow[];
  holdings: HoldingRow[];
  history: PriceHistoryPoint[];
  userId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);

  const businessNames = Object.fromEntries(
    businesses.map((b) => [b.id, companyDisplayName(b.name, b.ticker_symbol)]),
  );

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      setFlash(null);
      const r = await fn();
      setFlash(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {flash ? (
        <div
          role="status"
          className={`rounded border px-3 py-2 text-sm ${flash.ok ? "border-[var(--psc-border)]" : "border-rose-300 bg-rose-50 text-rose-950"}`}
        >
          {flash.message}
        </div>
      ) : null}

      <StockMarketChart history={history} businessNames={businessNames} />

      {holdings.length > 0 ? (
        <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Your holdings</h2>
            <Link href="/economy/stocks/portfolio" className="text-xs font-medium underline">
              Full portfolio
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-[var(--psc-border)]">
            {holdings.slice(0, 5).map((h) => {
              const price = Number(h.business?.price_per_share ?? 0);
              const name = h.business?.name ?? "Unknown";
              const ticker = h.business?.ticker_symbol;
              return (
                <li key={h.business_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
                  <div>
                    {ticker ? (
                      <Link href={`/economy/stocks/${ticker}`} className="font-medium hover:underline">
                        {companyDisplayName(name, ticker)}
                      </Link>
                    ) : (
                      <p className="font-medium">{name}</p>
                    )}
                    <p className="text-xs text-[var(--psc-muted)]">
                      {h.shares.toLocaleString()} shares · {formatUsd(h.shares * price)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
        <h2 className="text-base font-semibold">Market</h2>

        {businesses.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--psc-muted)]">
            No public companies yet.{" "}
            <Link href="/economy/stocks/create" className="underline">
              Incorporate the first one
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--psc-border)]">
            {businesses.map((b) => {
              const price = Number(b.price_per_share);
              const change = pctChange(history, b.id, price);
              const isOwner = b.owner_user_id === userId;
              const ticker = b.ticker_symbol;
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
                  <div>
                    <p className="font-medium">
                      {ticker ? (
                        <Link href={`/economy/stocks/${ticker}`} className="hover:underline">
                          {companyDisplayName(b.name, ticker)}
                        </Link>
                      ) : (
                        b.name
                      )}
                      {isOwner ? (
                        <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-[var(--psc-muted)]">
                          Founder
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-[var(--psc-muted)]">
                      <Link href={`/economy/stocks/sectors/${b.sector}`} className="hover:underline">
                        {sectorLabel(b.sector)}
                      </Link>
                      {b.market_share > 0 ? (
                        <span className="ml-2 font-mono">{formatMarketSharePct(b.market_share)} share</span>
                      ) : null}
                      {" · "}
                      {formatUsd(price, { decimals: 2 })}/share
                      {change !== null ? (
                        <span className={`ml-2 font-mono ${change >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          {change >= 0 ? "+" : ""}
                          {change.toFixed(1)}%
                        </span>
                      ) : null}
                      <span className="ml-2">· {b.shares_available.toLocaleString()} available</span>
                    </p>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      fd.set("business_id", b.id);
                      run(() => buyStock(fd));
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      name="shares"
                      type="number"
                      min={1}
                      max={b.shares_available}
                      defaultValue={100}
                      className="w-20 border border-[var(--psc-border)] px-2 py-1.5 font-mono text-xs"
                    />
                    <button
                      type="submit"
                      disabled={pending || b.shares_available < 1}
                      className="rounded border border-[var(--psc-ink)] px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                    >
                      Buy
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-xs text-[var(--psc-muted)]">
        Share prices move when people buy and sell. Holdings of 5% or more are disclosed publicly.{" "}
        <Link href="/economy/stocks/trades" className="underline">
          View all trades
        </Link>
        .
      </p>
    </div>
  );
}
