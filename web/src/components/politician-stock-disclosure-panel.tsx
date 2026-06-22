import Link from "next/link";
import { companyDisplayName, formatUsd } from "@/lib/stock-market";

export type PoliticianHoldingRow = {
  business_id: string;
  shares: number;
  name: string;
  ticker_symbol: string | null;
  price_per_share: number;
  sector: string;
};

export type PoliticianTradeRow = {
  id: string;
  trade_type: string;
  shares: number;
  price_per_share: number;
  total_value: number;
  created_at: string;
  company_name: string;
  ticker_symbol: string | null;
};

export type PoliticianVoteRow = {
  id: string;
  vote: string;
  chamber: string;
  created_at: string;
  bill_id: string;
  bill_title: string;
  affected_sector: string | null;
  stock_market_effect: number | null;
};

export function PoliticianStockDisclosurePanel({
  characterName,
  holdings,
  trades,
  votes,
}: {
  characterName: string;
  holdings: PoliticianHoldingRow[];
  trades: PoliticianTradeRow[];
  votes: PoliticianVoteRow[];
}) {
  return (
    <div className="space-y-6">
      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
        <h2 className="text-base font-semibold">Current holdings</h2>
        {holdings.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--psc-muted)]">No public stock holdings on record.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--psc-border)] text-sm">
            {holdings.map((h) => (
              <li key={h.business_id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <div>
                  {h.ticker_symbol ? (
                    <Link href={`/economy/stocks/${h.ticker_symbol}`} className="font-medium hover:underline">
                      {companyDisplayName(h.name, h.ticker_symbol)}
                    </Link>
                  ) : (
                    <span className="font-medium">{h.name}</span>
                  )}
                  <p className="text-xs text-[var(--psc-muted)]">{h.shares.toLocaleString()} shares</p>
                </div>
                <span className="font-mono text-xs">{formatUsd(h.shares * h.price_per_share)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
        <h2 className="text-base font-semibold">Recent trades</h2>
        {trades.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--psc-muted)]">No recent trades.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--psc-border)] text-sm">
            {trades.map((t) => (
              <li key={t.id} className="py-2 first:pt-0 last:pb-0">
                <p className="font-medium capitalize">
                  {t.trade_type === "buy" ? "Bought" : "Sold"} {t.shares.toLocaleString()} shares
                  {t.ticker_symbol ? (
                    <>
                      {" "}
                      of{" "}
                      <Link href={`/economy/stocks/${t.ticker_symbol}`} className="underline">
                        {t.company_name} ({t.ticker_symbol})
                      </Link>
                    </>
                  ) : (
                    <> of {t.company_name}</>
                  )}
                </p>
                <p className="text-xs text-[var(--psc-muted)]">
                  {formatUsd(Number(t.price_per_share), { decimals: 2 })}/share · {formatUsd(Number(t.total_value))} ·{" "}
                  {new Date(t.created_at).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
        <h2 className="text-base font-semibold">Recent votes</h2>
        {votes.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--psc-muted)]">No recorded floor votes.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--psc-border)] text-sm">
            {votes.map((v) => (
              <li key={v.id} className="py-2 first:pt-0 last:pb-0">
                <p className="font-medium">
                  Voted <span className="uppercase">{v.vote}</span> on{" "}
                  <Link href={`/bill/${v.bill_id}`} className="underline">
                    {v.bill_title}
                  </Link>
                </p>
                <p className="text-xs text-[var(--psc-muted)]">
                  {v.chamber === "house" ? "House" : "Senate"} · {new Date(v.created_at).toLocaleDateString()}
                  {v.affected_sector && v.stock_market_effect != null ? (
                    <span>
                      {" "}
                      · Sector impact: {v.affected_sector} {v.stock_market_effect > 0 ? "+" : ""}
                      {v.stock_market_effect}%
                    </span>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-[var(--psc-muted)]">
        Public record for {characterName}. Trade and vote timestamps are stored for transparency; timing analysis is not
        automated yet.
      </p>
    </div>
  );
}
