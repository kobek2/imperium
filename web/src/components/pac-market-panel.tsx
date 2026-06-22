"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buyPacMarketShares, sellPacMarketShares } from "@/app/actions/business";
import type { PacInvestmentRow, PacMarketRow } from "@/lib/business-data";

function formatMoney(amount: number): string {
  return `$${Number(amount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function PacMarketPanel({
  listings,
  investments,
  ownerNames,
  userId,
  economyFrozen,
}: {
  listings: PacMarketRow[];
  investments: PacInvestmentRow[];
  ownerNames: Record<string, string>;
  userId: string;
  economyFrozen: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);
  const [orderShares, setOrderShares] = useState<Record<string, string>>({});

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      setFlash(null);
      const r = await fn();
      setFlash(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      {flash ? (
        <div
          role="status"
          className={`rounded border px-3 py-2 text-sm ${
            flash.ok
              ? "border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-ink)_4%,transparent)]"
              : "border-rose-300 bg-rose-50 text-rose-950"
          }`}
        >
          {flash.message}
        </div>
      ) : null}

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Your PAC portfolio</h2>
          <p className="mt-1 text-sm text-[var(--psc-muted)]">
            Buy equity in other players&apos; PACs. Cash flows into their treasury and lifts share price — making their
            political machine more valuable (and more tempting to corrupt).
          </p>
        </div>
        {investments.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--psc-border)] px-4 py-6 text-sm text-[var(--psc-muted)]">
            No PAC holdings yet. Browse the market below.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-[var(--psc-border)] text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--psc-muted)]">
                <tr>
                  <th className="px-4 py-3">PAC</th>
                  <th className="px-4 py-3 text-right">Shares</th>
                  <th className="px-4 py-3 text-right">Avg cost</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3 text-right">P/L</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {investments.map((inv) => (
                  <tr key={inv.pac_id} className="border-b border-[var(--psc-border)]/60 font-mono text-xs">
                    <td className="px-4 py-3">{inv.pac_name}</td>
                    <td className="px-4 py-3 text-right">{inv.shares}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(inv.avg_cost)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(inv.share_price)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(inv.market_value)}</td>
                    <td
                      className={`px-4 py-3 text-right ${inv.gain_loss >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                    >
                      {inv.gain_loss >= 0 ? "+" : ""}
                      {formatMoney(inv.gain_loss)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={pending || economyFrozen}
                        onClick={() => {
                          const qty = Number(orderShares[inv.pac_id] ?? inv.shares);
                          const fd = new FormData();
                          fd.set("pac_id", inv.pac_id);
                          fd.set("shares", String(qty));
                          run(() => sellPacMarketShares(fd));
                        }}
                        className="rounded border border-rose-800 bg-rose-50 px-2 py-1 text-[10px] font-semibold uppercase disabled:opacity-60"
                      >
                        Sell all
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">PAC exchange</h2>
        {listings.length === 0 ? (
          <p className="text-sm text-[var(--psc-muted)]">No PACs registered yet.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {listings.map((pac) => {
              const isOwn = pac.owner_user_id === userId;
              const sharesInput = orderShares[pac.pac_id] ?? "100";
              const qty = Number(sharesInput);
              const estCost = Number.isFinite(qty) ? qty * pac.share_price : 0;
              return (
                <article
                  key={pac.pac_id}
                  className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-[var(--psc-ink)]">{pac.name}</h3>
                      <p className="text-xs text-[var(--psc-muted)]">
                        {ownerNames[pac.owner_user_id] ?? pac.owner_user_id.slice(0, 8)} · Tier {pac.tier}
                      </p>
                    </div>
                    <p className="font-mono text-sm font-semibold tabular-nums">{formatMoney(pac.share_price)}/sh</p>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-[var(--psc-muted)]">Valuation</dt>
                      <dd className="font-mono font-semibold">{formatMoney(pac.valuation)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--psc-muted)]">Treasury</dt>
                      <dd className="font-mono font-semibold">{formatMoney(pac.treasury_balance)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--psc-muted)]">Float available</dt>
                      <dd className="font-mono font-semibold">{pac.float_shares_available.toLocaleString()} sh</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--psc-muted)]">Investors</dt>
                      <dd className="font-mono font-semibold">{pac.investor_count}</dd>
                    </div>
                  </dl>
                  {isOwn ? (
                    <p className="mt-3 text-xs text-[var(--psc-muted)]">This is your PAC — outside investors buy in here.</p>
                  ) : (
                    <div className="mt-4 flex flex-wrap items-end gap-2">
                      <label className="grid gap-1 text-xs font-semibold">
                        Shares
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={sharesInput}
                          onChange={(e) =>
                            setOrderShares((prev) => ({ ...prev, [pac.pac_id]: e.target.value }))
                          }
                          className="w-24 border border-[var(--psc-border)] px-2 py-1.5 font-mono"
                        />
                      </label>
                      <p className="text-xs text-[var(--psc-muted)]">
                        Est. {formatMoney(estCost)} → treasury +{formatMoney(estCost)}
                      </p>
                      <button
                        type="button"
                        disabled={pending || economyFrozen || !Number.isFinite(qty) || qty <= 0}
                        onClick={() => {
                          const fd = new FormData();
                          fd.set("pac_id", pac.pac_id);
                          fd.set("shares", sharesInput);
                          run(() => buyPacMarketShares(fd));
                        }}
                        className="rounded border border-emerald-800 bg-emerald-50 px-3 py-2 text-xs font-semibold uppercase disabled:opacity-60"
                      >
                        Buy shares
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
