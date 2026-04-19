"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState, useEffect, useMemo } from "react";
import {
  buyCampaignAds,
  buyPac,
  collectEconomyIncome,
  depositPartyTreasury,
  transferToPlayer,
  upgradePac,
  applyCampaignAdFromInventory,
} from "@/app/actions/economy";
import {
  CAMPAIGN_AD_POINTS,
  CAMPAIGN_AD_UNIT_PRICE,
  ECONOMY_MAX_OFFLINE_HOURS,
  PAC_HOURLY_BY_LEVEL,
  PAC_LEVEL_1_COST,
  PAC_LEVEL_2_UPGRADE_COST,
  PAC_LEVEL_3_UPGRADE_COST,
} from "@/lib/economy-config";
import { EconomyBlackjack } from "./economy-blackjack";

type WalletRow = { balance: number; last_collected_at: string };
type PacRow = { level: number } | null;
type InvRow = { sku: string; quantity: number } | null;
type LedgerRow = { id: string; wallet_user_id: string; delta: number; kind: string; detail: unknown; created_at: string };
type Candidacy = { candidate_id: string; election_id: string; label: string };

const INCOME_COOLDOWN_MS = 60 * 60 * 1000;

function formatCollectWait(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h > 0) return `${h}h ${mm}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function useIncomeCollectGate(lastCollectedAtIso: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return useMemo(() => {
    if (!lastCollectedAtIso) return { ready: true, line: null as string | null };
    const eligibleAt = new Date(lastCollectedAtIso).getTime() + INCOME_COOLDOWN_MS;
    if (Number.isNaN(eligibleAt)) return { ready: true, line: null };
    const remaining = eligibleAt - now;
    if (remaining <= 0) return { ready: true, line: "Income is ready to collect." };
    return {
      ready: false,
      line: `Next collect in ${formatCollectWait(remaining)} (${new Date(eligibleAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })})`,
    };
  }, [lastCollectedAtIso, now]);
}

export function EconomyDashboard({
  wallet,
  pac,
  inventory,
  recentLedger,
  myCandidacies,
  viewerId,
  treasuryPartyKey,
}: {
  wallet: WalletRow | null;
  pac: PacRow;
  inventory: InvRow;
  recentLedger: LedgerRow[];
  myCandidacies: Candidacy[];
  viewerId: string;
  treasuryPartyKey: "democrat" | "republican" | null;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const balance = wallet?.balance ?? 0;
  const ads = inventory?.sku === "campaign_ad" ? inventory.quantity : 0;
  const collectGate = useIncomeCollectGate(wallet?.last_collected_at);

  function run(label: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      setMsg(null);
      const r = await fn();
      setMsg(r.message);
      if (r.ok && label === "collect") router.refresh();
    });
  }

  return (
    <div className="space-y-10">
      {msg ? (
        <p className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-3 text-sm text-[var(--psc-ink)]">
          {msg}
        </p>
      ) : null}

      <section className="grid gap-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Balance</p>
          <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-[var(--psc-ink)]">
            ${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <p className="mt-2 text-xs text-[var(--psc-muted)]">
            Hourly pay stacks your government role (see SQL rules) plus PAC income, up to{" "}
            {ECONOMY_MAX_OFFLINE_HOURS} hours per collection.
          </p>
        </div>
        <div className="flex flex-col justify-end gap-2">
          {collectGate.line ? (
            <p
              className={`text-xs ${collectGate.ready ? "text-emerald-800" : "text-[var(--psc-muted)]"}`}
              aria-live="polite"
            >
              {collectGate.line}
            </p>
          ) : null}
          <button
            type="button"
            disabled={pending || !collectGate.ready}
            onClick={() => run("collect", collectEconomyIncome)}
            className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-white disabled:opacity-60"
          >
            {pending ? "Working…" : "Collect hourly income"}
          </button>
        </div>
      </section>

      <section className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">PAC (passive income)</h2>
        <p className="text-sm text-[var(--psc-muted)]">
          Level 1: ${PAC_LEVEL_1_COST.toLocaleString()} purchase → +${PAC_HOURLY_BY_LEVEL[1].toLocaleString()}/hr. Level 2
          upgrade ${PAC_LEVEL_2_UPGRADE_COST.toLocaleString()} → +${PAC_HOURLY_BY_LEVEL[2].toLocaleString()}/hr. Level 3
          upgrade ${PAC_LEVEL_3_UPGRADE_COST.toLocaleString()} → +${PAC_HOURLY_BY_LEVEL[3].toLocaleString()}/hr.
        </p>
        {pac ? (
          <p className="text-sm font-semibold text-[var(--psc-ink)]">
            Your PAC is level <span className="font-mono">{pac.level}</span>.
          </p>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("pac", buyPac)}
            className="rounded border border-[var(--psc-accent)] bg-[var(--psc-accent)]/15 px-4 py-2 text-sm font-semibold text-[var(--psc-ink)] disabled:opacity-60"
          >
            Buy PAC (${PAC_LEVEL_1_COST.toLocaleString()})
          </button>
        )}
        {pac && pac.level < 3 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("up", upgradePac)}
            className="ml-0 rounded border border-[var(--psc-border)] px-4 py-2 text-sm font-semibold disabled:opacity-60 sm:ml-2"
          >
            Upgrade PAC
          </button>
        ) : null}
      </section>

      <section className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Campaign store</h2>
        <p className="text-sm text-[var(--psc-muted)]">
          TV ad: ${CAMPAIGN_AD_UNIT_PRICE.toLocaleString()} each, +{CAMPAIGN_AD_POINTS} campaign point when used on one
          of your active races. You have <strong className="text-[var(--psc-ink)]">{ads}</strong> in inventory.
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run("ads", () => buyCampaignAds(fd));
          }}
        >
          <label className="grid gap-1 text-xs font-semibold">
            Quantity
            <input name="qty" type="number" min={1} max={99} defaultValue={1} className="border px-2 py-1 font-mono" />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded border border-[var(--psc-ink)] bg-[var(--psc-canvas)] px-4 py-2 text-sm font-semibold disabled:opacity-60"
          >
            Buy ads
          </button>
        </form>

        {myCandidacies.length ? (
          <form
            className="grid gap-2 border-t border-[var(--psc-border)] pt-4 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              run("use", () => applyCampaignAdFromInventory(fd));
            }}
          >
            <label className="grid gap-1 font-semibold">
              Spend 1 ad on a race
              <select name="candidacy" required className="border px-2 py-2 font-normal">
                <option value="">Select your candidacy…</option>
                {myCandidacies.map((c) => (
                  <option key={c.candidate_id} value={`${c.election_id}__${c.candidate_id}`}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={pending || ads < 1}
              className="justify-self-start rounded border border-[var(--psc-border)] px-4 py-2 text-xs font-semibold uppercase disabled:opacity-60"
            >
              Use ad (+{CAMPAIGN_AD_POINTS} pt)
            </button>
          </form>
        ) : (
          <p className="text-xs text-[var(--psc-muted)]">File for an active race to spend ads here.</p>
        )}
      </section>

      <section
        className={`grid gap-6 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 ${treasuryPartyKey ? "md:grid-cols-2" : ""}`}
      >
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Send cash</h2>
          <p className="text-xs text-[var(--psc-muted)]">
            Enter the recipient&apos;s Discord username (same handle shown in-game; optional @ prefix or legacy
            #1234 suffix is fine).
          </p>
          <form
            className="grid gap-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              run("xfer", () => transferToPlayer(new FormData(e.currentTarget)));
            }}
          >
            <label className="grid gap-1 font-semibold">
              Discord username
              <input
                name="recipient_discord_username"
                autoComplete="off"
                placeholder="e.g. pat_smith"
                className="border px-2 py-2 font-normal"
              />
            </label>
            <label className="grid gap-1 font-semibold">
              Amount ($)
              <input name="amount" type="number" min={1} step={1} placeholder="Amount" className="border px-2 py-2 font-mono" />
            </label>
            <button type="submit" disabled={pending} className="rounded border px-3 py-2 text-xs font-semibold disabled:opacity-60">
              Transfer
            </button>
          </form>
        </div>
        {treasuryPartyKey ? (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Party treasury</h2>
            <p className="text-xs text-[var(--psc-muted)]">
              Deposits go only to your affiliation (
              {treasuryPartyKey === "democrat" ? "Democratic Party" : "Republican Party"}).
            </p>
            <form
              className="grid gap-2 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                run("pty", () => depositPartyTreasury(new FormData(e.currentTarget)));
              }}
            >
              <input type="hidden" name="party_key" value={treasuryPartyKey} />
              <label className="grid gap-1 font-semibold">
                Amount ($)
                <input name="amount" type="number" min={1} step={1} placeholder="Amount" className="border px-2 py-2 font-mono" />
              </label>
              <button type="submit" disabled={pending} className="rounded border px-3 py-2 text-xs font-semibold disabled:opacity-60">
                Deposit to party
              </button>
            </form>
          </div>
        ) : null}
      </section>

      <EconomyBlackjack />

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Recent public ledger</h2>
          <p className="text-xs text-[var(--psc-muted)]">Your id (for reading rows): {viewerId.slice(0, 8)}…</p>
        </div>
        <ul className="mt-4 max-h-80 space-y-2 overflow-y-auto font-mono text-[11px] text-[var(--psc-muted)]">
          {recentLedger.map((row) => (
            <li key={row.id} className="flex flex-wrap justify-between gap-2 border-b border-[var(--psc-border)]/60 py-2">
              <span>{new Date(row.created_at).toLocaleString()}</span>
              <span className="text-[var(--psc-ink)]">{row.kind}</span>
              <span className={row.delta >= 0 ? "text-emerald-700" : "text-rose-700"}>
                {row.delta >= 0 ? "+" : ""}
                {Number(row.delta).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
