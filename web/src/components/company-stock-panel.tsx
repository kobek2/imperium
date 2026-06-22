"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buyStock, sellStock } from "@/app/actions/economy";
import {
  formatGrowthRate,
  formatMarketCap,
  formatMarketSharePct,
  formatRevenue,
  formatUsd,
  founderOwnershipPct,
  publicOwnershipPct,
  sectorLabel,
  sectorRankLabel,
  strategyLabel,
} from "@/lib/stock-market";

export type CompanyDetail = {
  id: string;
  name: string;
  ticker_symbol: string;
  sector: string;
  description: string | null;
  primary_focus: string | null;
  strategy: string | null;
  price_per_share: number;
  valuation: number | null;
  total_shares: number;
  public_shares: number | null;
  founder_shares: number | null;
  shares_available: number;
  owner_user_id: string;
  ipo_date: string | null;
  created_at: string;
  founder_name: string | null;
  revenue: number;
  growth_rate: number;
  market_share: number;
  sector_rank: number | null;
};

export function CompanyStockPanel({
  company,
  userId,
  userShares,
}: {
  company: CompanyDetail;
  userId: string;
  userShares: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);
  const isFounder = company.owner_user_id === userId;

  const price = Number(company.price_per_share);
  const valuation = company.valuation ?? price * company.total_shares;
  const publicSh = company.public_shares ?? company.shares_available;
  const founderSh = company.founder_shares ?? company.total_shares - publicSh;

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

      <header className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--psc-muted)]">{company.ticker_symbol}</p>
        <h1 className="mt-1 text-2xl font-semibold">{company.name}</h1>
        <p className="mt-2 text-sm text-[var(--psc-muted)]">
          {sectorLabel(company.sector)}
          {company.sector_rank != null ? (
            <>
              {" "}
              · <span className="font-medium text-[var(--psc-ink)]">{sectorRankLabel(company.sector_rank, company.sector)}</span>
            </>
          ) : null}
          {company.market_share > 0 ? (
            <>
              {" "}
              · <span className="font-mono">{formatMarketSharePct(company.market_share)}</span> market share
            </>
          ) : null}
        </p>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--psc-muted)]">Current price</dt>
            <dd className="font-mono">{formatUsd(price, { decimals: 2 })}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--psc-muted)]">Market value</dt>
            <dd className="font-mono">{formatMarketCap(valuation)}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--psc-muted)]">Revenue</dt>
            <dd className="font-mono">{formatRevenue(company.revenue)}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--psc-muted)]">Growth rate</dt>
            <dd className="font-mono">{formatGrowthRate(company.growth_rate)}/hr</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--psc-muted)]">Shares available</dt>
            <dd className="font-mono">{company.shares_available.toLocaleString()}</dd>
          </div>
        </dl>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          <h2 className="text-base font-semibold">Ownership</h2>
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--psc-muted)]">Founder ownership</dt>
              <dd className="font-mono">{founderOwnershipPct(founderSh, company.total_shares).toFixed(1)}%</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--psc-muted)]">Public float</dt>
              <dd className="font-mono">{publicOwnershipPct(publicSh, company.total_shares).toFixed(1)}%</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--psc-muted)]">Shares outstanding</dt>
              <dd className="font-mono">{company.total_shares.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--psc-muted)]">Available to buy</dt>
              <dd className="font-mono">{company.shares_available.toLocaleString()}</dd>
            </div>
            {userShares > 0 ? (
              <div className="flex justify-between border-t border-[var(--psc-border)] pt-2">
                <dt className="text-[var(--psc-muted)]">Your position</dt>
                <dd className="font-mono">
                  {userShares.toLocaleString()} shares ({((userShares / company.total_shares) * 100).toFixed(2)}%)
                </dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          <h2 className="text-base font-semibold">Trade</h2>
          <div className="mt-3 space-y-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                fd.set("business_id", company.id);
                run(() => buyStock(fd));
              }}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="grid gap-1 text-xs">
                Buy shares
                <input
                  name="shares"
                  type="number"
                  min={1}
                  max={company.shares_available}
                  defaultValue={100}
                  className="w-28 border border-[var(--psc-border)] px-2 py-1.5 font-mono"
                />
              </label>
              <button
                type="submit"
                disabled={pending || company.shares_available < 1}
                className="rounded border border-[var(--psc-ink)] px-3 py-1.5 text-xs font-medium disabled:opacity-40"
              >
                Buy
              </button>
            </form>

            {userShares > 0 ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  fd.set("business_id", company.id);
                  run(() => sellStock(fd));
                }}
                className="flex flex-wrap items-end gap-2"
              >
                <label className="grid gap-1 text-xs">
                  Sell shares
                  <input
                    name="shares"
                    type="number"
                    min={1}
                    max={userShares}
                    defaultValue={Math.min(100, userShares)}
                    className="w-28 border border-[var(--psc-border)] px-2 py-1.5 font-mono"
                  />
                </label>
                <button type="submit" disabled={pending} className="rounded border border-[var(--psc-border)] px-3 py-1.5 text-xs font-medium">
                  Sell
                </button>
              </form>
            ) : null}
          </div>
        </section>
      </div>

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
        <h2 className="text-base font-semibold">Company information</h2>
        <dl className="mt-3 grid gap-3 text-sm">
          <div>
            <dt className="text-xs text-[var(--psc-muted)]">Description</dt>
            <dd className="mt-0.5">{company.description ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--psc-muted)]">Primary focus</dt>
            <dd className="mt-0.5">{company.primary_focus ?? "—"}</dd>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-[var(--psc-muted)]">Strategy</dt>
              <dd>{strategyLabel(company.strategy)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--psc-muted)]">Sector market</dt>
              <dd>
                <Link href={`/economy/stocks/sectors/${company.sector}`} className="underline">
                  {sectorLabel(company.sector)} rankings
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--psc-muted)]">IPO date</dt>
              <dd>{company.ipo_date ? new Date(company.ipo_date).toLocaleDateString() : new Date(company.created_at).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--psc-muted)]">Founder</dt>
              <dd>{company.founder_name ?? "—"}</dd>
            </div>
          </div>
        </dl>
      </section>

      <p className="text-xs text-[var(--psc-muted)]">
        {isFounder ? "You founded this company. " : null}
        <Link href="/economy/stocks/trades" className="underline">
          View public trade history
        </Link>
      </p>
    </div>
  );
}
