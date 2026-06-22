import Link from "next/link";
import { formatSectorEffectPct, sectorLabel } from "@/lib/legislation-stock";
import { formatUsd } from "@/lib/stock-market";

export type MarketEventRow = {
  id: string;
  headline: string;
  affected_sector: string;
  sector_effect_pct: number;
  created_at: string;
  bill_id: string | null;
  companies: Array<{
    company_name: string;
    ticker_symbol: string | null;
    price_before: number;
    price_after: number;
  }>;
};

export function MarketEventsFeed({ events }: { events: MarketEventRow[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-[var(--psc-muted)]">No legislation-driven market events yet.</p>;
  }

  return (
    <ul className="divide-y divide-[var(--psc-border)]">
      {events.map((ev) => (
        <li key={ev.id} className="py-4 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{ev.headline}</p>
              <p className="mt-1 text-xs text-[var(--psc-muted)]">
                {sectorLabel(ev.affected_sector)} sector:{" "}
                <span className={`font-mono font-semibold ${ev.sector_effect_pct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {formatSectorEffectPct(Number(ev.sector_effect_pct))}
                </span>
                <span className="ml-2">· {new Date(ev.created_at).toLocaleString()}</span>
              </p>
              {ev.bill_id ? (
                <Link href={`/bill/${ev.bill_id}`} className="mt-1 inline-block text-xs font-medium underline">
                  View bill
                </Link>
              ) : null}
            </div>
          </div>
          {ev.companies.length > 0 ? (
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Affected companies</p>
              <ul className="mt-2 space-y-1 text-sm">
                {ev.companies.map((c) => (
                  <li key={`${ev.id}-${c.ticker_symbol ?? c.company_name}`} className="flex flex-wrap items-center gap-2">
                    {c.ticker_symbol ? (
                      <Link href={`/economy/stocks/${c.ticker_symbol}`} className="font-medium hover:underline">
                        {c.company_name} ({c.ticker_symbol})
                      </Link>
                    ) : (
                      <span className="font-medium">{c.company_name}</span>
                    )}
                    <span className="font-mono text-xs text-[var(--psc-muted)]">
                      {formatUsd(Number(c.price_before), { decimals: 2 })} → {formatUsd(Number(c.price_after), { decimals: 2 })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
