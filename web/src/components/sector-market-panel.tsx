import Link from "next/link";
import {
  companyDisplayName,
  formatGrowthRate,
  formatMarketSharePct,
  formatRevenue,
  ordinalRank,
  sectorLabel,
} from "@/lib/stock-market";

export type SectorCompanyRow = {
  id: string;
  name: string;
  ticker_symbol: string | null;
  revenue: number;
  market_share: number;
  growth_rate: number;
  strategy: string | null;
  rank: number;
};

export type SectorOverviewRow = {
  sector: string;
  total_sector_revenue: number;
  market_concentration: number;
  company_count: number;
  leader_name: string | null;
  leader_ticker: string | null;
};

export function SectorOverviewPanel({ sectors }: { sectors: SectorOverviewRow[] }) {
  const active = sectors.filter((s) => s.company_count > 0);
  const empty = sectors.filter((s) => s.company_count === 0);

  return (
    <div className="space-y-6">
      {active.length === 0 ? (
        <p className="text-sm text-[var(--psc-muted)]">
          No public companies yet.{" "}
          <Link href="/economy/stocks/create" className="underline">
            Incorporate the first one
          </Link>
          .
        </p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {active.map((s) => (
            <li key={s.sector}>
              <Link
                href={`/economy/stocks/sectors/${s.sector}`}
                className="block rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 transition hover:border-[var(--psc-ink)]"
              >
                <h2 className="text-base font-semibold">{sectorLabel(s.sector)} Industry</h2>
                <dl className="mt-3 grid gap-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--psc-muted)]">Total market</dt>
                    <dd className="font-mono">{formatRevenue(s.total_sector_revenue)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--psc-muted)]">Companies</dt>
                    <dd className="font-mono">{s.company_count}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--psc-muted)]">Market leader</dt>
                    <dd className="text-right">
                      {s.leader_ticker ? companyDisplayName(s.leader_name ?? "", s.leader_ticker) : "—"}
                      {s.market_concentration > 0 ? (
                        <span className="ml-2 font-mono text-xs text-[var(--psc-muted)]">
                          {formatMarketSharePct(s.market_concentration)}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {empty.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold text-[var(--psc-muted)]">Empty sectors</h2>
          <p className="mt-2 text-xs text-[var(--psc-muted)]">
            {empty.map((s) => sectorLabel(s.sector)).join(" · ")}
          </p>
        </section>
      ) : null}
    </div>
  );
}

export function SectorDetailPanel({
  sector,
  totalRevenue,
  companies,
}: {
  sector: string;
  totalRevenue: number;
  companies: SectorCompanyRow[];
}) {
  const listed = companies.filter((c) => c.revenue > 0);
  const otherShare = Math.max(0, 100 - listed.reduce((sum, c) => sum + c.market_share, 0));

  return (
    <div className="space-y-6">
      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
        <h2 className="text-base font-semibold">{sectorLabel(sector)} Industry</h2>
        <dl className="mt-3 grid max-w-md gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--psc-muted)]">Total market</dt>
            <dd className="font-mono">{formatRevenue(totalRevenue)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--psc-muted)]">Listed companies</dt>
            <dd className="font-mono">{listed.length}</dd>
          </div>
        </dl>
      </section>

      {listed.length === 0 ? (
        <p className="text-sm text-[var(--psc-muted)]">No companies in this sector yet.</p>
      ) : (
        <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          <h3 className="text-base font-semibold">Companies</h3>
          <ul className="mt-4 divide-y divide-[var(--psc-border)]">
            {listed.map((c) => (
              <li key={c.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {c.ticker_symbol ? (
                        <Link href={`/economy/stocks/${c.ticker_symbol}`} className="hover:underline">
                          {companyDisplayName(c.name, c.ticker_symbol)}
                        </Link>
                      ) : (
                        c.name
                      )}
                    </p>
                    <dl className="mt-2 grid gap-1 text-xs text-[var(--psc-muted)] sm:grid-cols-2">
                      <div>
                        <dt className="inline">Market share: </dt>
                        <dd className="inline font-mono text-[var(--psc-ink)]">{formatMarketSharePct(c.market_share)}</dd>
                      </div>
                      <div>
                        <dt className="inline">Revenue: </dt>
                        <dd className="inline font-mono text-[var(--psc-ink)]">{formatRevenue(c.revenue)}</dd>
                      </div>
                      <div>
                        <dt className="inline">Growth: </dt>
                        <dd className="inline font-mono text-[var(--psc-ink)]">{formatGrowthRate(c.growth_rate)}/hr</dd>
                      </div>
                      <div>
                        <dt className="inline">Rank: </dt>
                        <dd className="inline font-mono text-[var(--psc-ink)]">{ordinalRank(c.rank)}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {listed.length > 1 && otherShare >= 0.01 ? (
            <p className="mt-4 border-t border-[var(--psc-border)] pt-4 text-xs text-[var(--psc-muted)]">
              Rounding remainder: {formatMarketSharePct(otherShare)} across listed companies.
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
