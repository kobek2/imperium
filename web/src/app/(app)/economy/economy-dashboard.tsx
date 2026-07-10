"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState, useEffect, useMemo } from "react";
import {
  collectEconomyIncome,
  depositPartyTreasury,
  transferToPlayer,
} from "@/app/actions/economy";
import { payFiscalTax } from "@/app/actions/fiscal";
import { NavRouteButton } from "@/components/nav-route-button";
import { ProfileTypeaheadInput } from "@/components/profile-typeahead-input";
import { EconomyBlackjack } from "./economy-blackjack";
import { EconomyPublicLedgerList } from "@/components/economy-public-ledger-list";
import { EconomyCampaignAds } from "@/components/economy-campaign-ads";
import type { CampaignAdInventory } from "@/lib/campaign-ad-inventory";
import type { EconomyLedgerDisplayRow } from "@/lib/economy-ledger-view";

type WalletRow = { balance: number; last_collected_at: string };
type InvRow = { sku: string; quantity: number } | null;
type LedgerRow = EconomyLedgerDisplayRow;
type FlashSection = "balance" | "payments" | "tax" | "campaign";
type FlashDetail = { label: string; value: string; tone?: "positive" | "negative" | "neutral" };

const INCOME_COOLDOWN_MS = 60 * 60 * 1000;

function sectionFlash(
  flash: { message: string; ok: boolean; section: FlashSection; details?: FlashDetail[] } | null,
  section: FlashSection,
) {
  if (!flash || flash.section !== section) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded border px-3 py-2 text-sm ${
        flash.ok
          ? "border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-ink)_4%,transparent)] text-[var(--psc-ink)]"
          : "border-rose-300 bg-rose-50 text-rose-950"
      }`}
    >
      <p className="m-0">{flash.message}</p>
      {flash.details?.length ? (
        <ul className="mt-2 space-y-1 text-xs">
          {flash.details.map((d) => (
            <li key={`${d.label}:${d.value}`} className="flex items-center justify-between gap-2">
              <span className="text-[var(--psc-muted)]">{d.label}</span>
              <span
                className={`font-mono font-semibold ${
                  d.tone === "negative"
                    ? "text-rose-800"
                    : d.tone === "positive"
                      ? "text-emerald-800"
                      : "text-[var(--psc-ink)]"
                }`}
              >
                {d.value}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatCollectWait(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h > 0) return `${h}h ${mm}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatMoney(amount: number | null | undefined): string {
  return `$${Number(amount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function useIncomeCollectGate(lastCollectedAtIso: string | undefined) {
  /** `null` until after mount so SSR and the first client paint match (no Date.now() split). */
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const firstTick = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(id);
    };
  }, []);

  return useMemo(() => {
    if (!lastCollectedAtIso) return { ready: true, line: null as string | null };
    const eligibleAt = new Date(lastCollectedAtIso).getTime() + INCOME_COOLDOWN_MS;
    if (Number.isNaN(eligibleAt)) return { ready: true, line: null };
    if (now === null) {
      return {
        ready: false,
        line: "Preparing collection timer…",
      };
    }
    const remaining = eligibleAt - now;
    if (remaining <= 0) return { ready: true, line: "Income is ready to collect." };
    return {
      ready: false,
      line: `Next collect in ${formatCollectWait(remaining)} (${new Date(eligibleAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })})`,
    };
  }, [lastCollectedAtIso, now]);
}

export function FinancesDashboard({
  wallet,
  recentLedger,
  treasuryPartyKey,
  economyFrozen,
  federalEstimatedTax,
  taxAccount,
  showFederalBudgetLink,
  adsInventory,
}: {
  wallet: WalletRow | null;
  inventory?: InvRow;
  recentLedger: LedgerRow[];
  treasuryPartyKey: "democrat" | "republican" | null;
  economyFrozen: boolean;
  federalEstimatedTax?: number | null;
  taxAccount?: {
    assessed_tax?: number;
    paid_amount?: number;
    outstanding_amount?: number;
    total_penalties?: number;
    due_at?: string;
    status?: string;
  } | null;
  showFederalBudgetLink: boolean;
  adsInventory: CampaignAdInventory;
}) {
  const router = useRouter();
  const [flash, setFlash] = useState<{
    message: string;
    ok: boolean;
    section: FlashSection;
    details?: FlashDetail[];
  } | null>(null);
  const [pending, start] = useTransition();
  const balance = wallet?.balance ?? 0;
  const collectGate = useIncomeCollectGate(wallet?.last_collected_at);
  const taxOwed = Number(taxAccount?.outstanding_amount ?? taxAccount?.assessed_tax ?? 0);
  const taxPaid = Number(taxAccount?.paid_amount ?? 0);
  const taxPrediction = Number(federalEstimatedTax ?? 0);

  function run(
    section: FlashSection,
    label: string,
    fn: () => Promise<{ ok: boolean; message: string; details?: FlashDetail[] }>,
  ) {
    start(async () => {
      setFlash(null);
      const r = await fn();
      setFlash({ message: r.message, ok: r.ok, section, details: r.details });
      if (r.ok && (label === "collect" || label === "tax")) router.refresh();
    });
  }

  const freezeDisabled = economyFrozen;

  return (
    <div className="space-y-10">
      <section className="space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 text-sm text-[var(--psc-ink)]">
        {economyFrozen ? (
          <p className="rounded border border-emerald-200 bg-emerald-50/90 px-3 py-2 text-xs text-emerald-950">
            Staff shutdown is on for other economy actions, but you can still pay federal income tax into the Treasury
            anytime this window is open.
          </p>
        ) : null}
        {sectionFlash(flash, "tax")}
        <div className="grid gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))_minmax(220px,1.25fr)] md:items-end">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Owe</p>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{formatMoney(taxOwed)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Paid</p>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{formatMoney(taxPaid)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">RP-year tax preview</p>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{formatMoney(taxPrediction)}</p>
          </div>
          {taxAccount ? (
            <form
              className="flex flex-wrap gap-2 md:justify-end"
              onSubmit={(e) => {
                e.preventDefault();
                run("tax", "tax", () => payFiscalTax(new FormData(e.currentTarget)));
              }}
            >
              <input
                name="amount"
                type="number"
                min={1}
                step={1}
                placeholder="Pay amount"
                className="min-w-0 flex-1 border border-[var(--psc-border)] px-2 py-2 font-mono md:max-w-44"
              />
              <button
                type="submit"
                disabled={pending}
                className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase text-white disabled:opacity-60"
              >
                Pay
              </button>
            </form>
          ) : (
            <p className="text-xs text-[var(--psc-muted)] md:text-right">No assessed tax account yet.</p>
          )}
        </div>
        {taxAccount?.due_at || taxAccount?.status ? (
          <p className="mt-3 text-xs text-[var(--psc-muted)]">
            {taxAccount.status ? `Status: ${taxAccount.status}` : ""}
            {taxAccount.status && taxAccount.due_at ? " · " : ""}
            {taxAccount.due_at ? `Due ${new Date(taxAccount.due_at).toLocaleString()}` : ""}
          </p>
        ) : null}
      </section>
      {economyFrozen ? (
        <div className="rounded border border-rose-400/80 bg-rose-50 p-4 text-sm text-rose-950">
          <p className="font-semibold">Government shutdown</p>
          <p className="mt-2 leading-relaxed">
            Staff have frozen economic activity for this simulation (manual shutdown). Collects, purchases,
            gambling, and party treasury actions stay blocked until administrators clear the freeze on the active
            fiscal year.
            The appropriations countdown is a staff-started reminder only; shutdown is staff-controlled.{" "}
            {showFederalBudgetLink ? (
              <NavRouteButton
                href="/economy/federal"
                className="border-rose-800/50 bg-rose-50 text-rose-950 hover:bg-rose-100"
              >
                Open federal budget
              </NavRouteButton>
            ) : null}
          </p>
        </div>
      ) : null}
      <section className="grid gap-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3">{sectionFlash(flash, "balance")}</div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Balance</p>
          <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-[var(--psc-ink)]">
            ${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
            disabled={pending || !collectGate.ready || freezeDisabled}
            onClick={() => run("balance", "collect", collectEconomyIncome)}
            className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-white disabled:opacity-60"
          >
            {pending ? "Working…" : "Collect hourly income"}
          </button>
        </div>
      </section>

      <div className="space-y-3">
        {sectionFlash(flash, "campaign")}
        <EconomyCampaignAds
          inventory={adsInventory}
          economyFrozen={freezeDisabled}
          onFlash={(message, ok) => setFlash({ message, ok, section: "campaign" })}
        />
      </div>

      <EconomyBlackjack economyFrozen={freezeDisabled} />

      <section
        className={`grid gap-8 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 ${treasuryPartyKey ? "md:grid-cols-2 md:items-stretch md:gap-0" : ""}`}
      >
        {flash?.section === "payments" ? (
          <div className="md:col-span-2">{sectionFlash(flash, "payments")}</div>
        ) : null}
        <div className={`flex min-h-0 flex-col gap-3 md:h-full ${treasuryPartyKey ? "md:pr-8" : ""}`}>
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Send cash</h2>
          <p className="min-h-[3.5rem] text-xs leading-snug text-[var(--psc-muted)]">
            Search by character name and choose who should receive the transfer.
          </p>
          <form
            className="flex flex-col gap-2 text-sm md:min-h-0 md:flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              run("payments", "xfer", () => transferToPlayer(new FormData(e.currentTarget)));
            }}
          >
            <label className="grid w-full gap-1 font-semibold">
              Recipient
              <ProfileTypeaheadInput hiddenName="recipient_user_id" placeholder="Type character name..." required />
            </label>
            <div className="hidden min-h-0 flex-1 md:block" aria-hidden="true" />
            <label className="grid w-full gap-1 font-semibold">
              Amount ($)
              <input
                name="amount"
                type="number"
                min={1}
                step={1}
                placeholder="Amount"
                className="w-full border border-[var(--psc-border)] px-2 py-2 font-mono"
              />
            </label>
            <button
              type="submit"
              disabled={pending || freezeDisabled}
              className="w-full rounded border border-[var(--psc-ink)] bg-[var(--psc-canvas)] px-3 py-2.5 text-xs font-semibold uppercase tracking-wide transition hover:bg-[color-mix(in_srgb,var(--psc-ink)_6%,var(--psc-canvas))] disabled:opacity-60"
            >
              Transfer
            </button>
          </form>
        </div>
        {treasuryPartyKey ? (
          <div className="flex min-h-0 flex-col gap-3 border-t border-[var(--psc-border)] pt-8 md:h-full md:border-l md:border-t-0 md:pl-8 md:pt-0">
            <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Party treasury</h2>
            <p className="min-h-[3.5rem] text-xs leading-snug text-[var(--psc-muted)]">
              Deposits go only to your affiliation (
              {treasuryPartyKey === "democrat" ? "Democratic Party" : "Republican Party"}).
            </p>
            <form
              className="flex flex-col gap-2 text-sm md:min-h-0 md:flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                run("payments", "pty", () => depositPartyTreasury(new FormData(e.currentTarget)));
              }}
            >
              <input type="hidden" name="party_key" value={treasuryPartyKey} />
              <div className="hidden min-h-0 flex-1 md:block" aria-hidden="true" />
              <label className="grid w-full gap-1 font-semibold">
                Amount ($)
                <input
                  name="amount"
                  type="number"
                  min={1}
                  step={1}
                  placeholder="Amount"
                  className="w-full border border-[var(--psc-border)] px-2 py-2 font-mono"
                />
              </label>
              <button
                type="submit"
                disabled={pending || freezeDisabled}
                className="w-full rounded border border-[var(--psc-ink)] bg-[var(--psc-canvas)] px-3 py-2.5 text-xs font-semibold uppercase tracking-wide transition hover:bg-[color-mix(in_srgb,var(--psc-ink)_6%,var(--psc-canvas))] disabled:opacity-60"
              >
                Deposit to party
              </button>
            </form>
          </div>
        ) : null}
      </section>

      <EconomyPublicLedgerList rows={recentLedger} />
    </div>
  );
}

/** @deprecated Use FinancesDashboard */
export const EconomyDashboard = FinancesDashboard;
