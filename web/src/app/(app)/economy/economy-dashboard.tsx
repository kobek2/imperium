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
} from "@/app/actions/economy";
import { payFiscalTax } from "@/app/actions/fiscal";
import {
  CAMPAIGN_AD_POINTS,
  CAMPAIGN_AD_UNIT_PRICE,
  PAC_LEVEL_1_COST,
  PAC_LEVEL_2_UPGRADE_COST,
  PAC_LEVEL_3_UPGRADE_COST,
  PAC_HOURLY_BY_LEVEL,
} from "@/lib/economy-config";
import { NavRouteButton } from "@/components/nav-route-button";
import { ProfileTypeaheadInput } from "@/components/profile-typeahead-input";
import { EconomyBlackjack } from "./economy-blackjack";

type WalletRow = { balance: number; last_collected_at: string };
type PacRow = { level: number } | null;
type InvRow = { sku: string; quantity: number } | null;
type LedgerRow = { id: string; wallet_user_id: string; delta: number; kind: string; detail: unknown; created_at: string };
type FlashSection = "balance" | "pac" | "ads" | "payments";
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

export function EconomyDashboard({
  wallet,
  pac,
  inventory,
  recentLedger,
  viewerId,
  treasuryPartyKey,
  economyFrozen,
  governmentShutdown,
  calendarBudgetFreeze,
  appropriationDeadlineAt,
  federalEstimatedTax,
  taxAccount,
  showFederalBudgetLink,
}: {
  wallet: WalletRow | null;
  pac: PacRow;
  inventory: InvRow;
  recentLedger: LedgerRow[];
  viewerId: string;
  treasuryPartyKey: "democrat" | "republican" | null;
  economyFrozen: boolean;
  governmentShutdown?: boolean;
  calendarBudgetFreeze?: boolean;
  appropriationDeadlineAt?: string | null;
  federalEstimatedTax?: number | null;
  taxAccount?: {
    assessed_tax?: number;
    paid_amount?: number;
    outstanding_amount?: number;
    total_penalties?: number;
    due_at?: string;
    status?: string;
  } | null;
  /** President / game admin — federal appropriations workspace. */
  showFederalBudgetLink: boolean;
}) {
  const router = useRouter();
  const [flash, setFlash] = useState<{
    message: string;
    ok: boolean;
    section: FlashSection;
    details?: FlashDetail[];
  } | null>(null);
  const [adQtyInput, setAdQtyInput] = useState("1");
  const [pending, start] = useTransition();
  const balance = wallet?.balance ?? 0;
  const ads = inventory?.sku === "campaign_ad" ? inventory.quantity : 0;
  const adQtyParsed = Number(adQtyInput);
  const adQty = Number.isFinite(adQtyParsed) ? Math.max(0, Math.floor(adQtyParsed)) : 0;
  const adLineTotal = adQty * CAMPAIGN_AD_UNIT_PRICE;
  const collectGate = useIncomeCollectGate(wallet?.last_collected_at);
  const currentPacHourly = pac ? PAC_HOURLY_BY_LEVEL[pac.level as 1 | 2 | 3] ?? 0 : 0;
  const nextPacLevel = pac && pac.level < 3 ? ((pac.level + 1) as 2 | 3) : null;
  const nextPacHourly = nextPacLevel ? PAC_HOURLY_BY_LEVEL[nextPacLevel] : null;
  const nextPacUpgradeCost =
    pac?.level === 1 ? PAC_LEVEL_2_UPGRADE_COST : pac?.level === 2 ? PAC_LEVEL_3_UPGRADE_COST : null;

  function run(
    section: FlashSection,
    label: string,
    fn: () => Promise<{ ok: boolean; message: string; details?: FlashDetail[] }>,
  ) {
    start(async () => {
      setFlash(null);
      const r = await fn();
      setFlash({ message: r.message, ok: r.ok, section, details: r.details });
      if (r.ok && label === "collect") router.refresh();
    });
  }

  const freezeDisabled = economyFrozen;

  return (
    <div className="space-y-10">
      {economyFrozen ? (
        <div className="rounded border border-rose-400/80 bg-rose-50 p-4 text-sm text-rose-950">
          <p className="font-semibold">
            {governmentShutdown
              ? "Government shutdown"
              : calendarBudgetFreeze
                ? "Economy frozen (budget deadline)"
                : "Economy frozen"}
          </p>
          <p className="mt-2 leading-relaxed">
            {governmentShutdown ? (
              <>
                The annual appropriations act was not enrolled before the statutory deadline (one IRL day after the fiscal year
                opened). Collects, purchases, and other economy debits are suspended until Congress enrolls appropriations and
                the President signs the bill into law.
              </>
            ) : calendarBudgetFreeze ? (
              <>
                The simulation calendar marked the federal budget deadline without an enrolled appropriations act. Wallet
                mutations stay blocked until the President signs appropriations into law or staff uses the emergency unfreeze
                tool.
              </>
            ) : (
              <>
                The active fiscal year&apos;s federal budget must be marked <strong>submitted</strong> (after the appropriations
                act is adopted in Congress) before wallets, gambling, PACs, and party treasury actions work.
              </>
            )}{" "}
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
      {!economyFrozen && Number.isFinite(federalEstimatedTax ?? NaN) ? (
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 text-sm text-[var(--psc-ink)]">
          <p className="font-semibold">Estimated federal income tax (if year closed now)</p>
          <p className="mt-2 font-mono text-lg font-semibold tabular-nums">
            ${Number(federalEstimatedTax ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
      ) : null}
      {!economyFrozen ? (
        <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 text-sm text-[var(--psc-ink)]">
          <p className="font-semibold">Tax account</p>
          {taxAccount ? (
            <>
              <p className="mt-2 text-[var(--psc-muted)]">
                Assessed: <span className="font-mono text-[var(--psc-ink)]">${Number(taxAccount.assessed_tax ?? 0).toLocaleString()}</span>
                {" · "}Paid: <span className="font-mono text-[var(--psc-ink)]">${Number(taxAccount.paid_amount ?? 0).toLocaleString()}</span>
                {" · "}Outstanding:{" "}
                <span className="font-mono text-[var(--psc-ink)]">${Number(taxAccount.outstanding_amount ?? 0).toLocaleString()}</span>
                {" · "}Penalties: <span className="font-mono text-[var(--psc-ink)]">${Number(taxAccount.total_penalties ?? 0).toLocaleString()}</span>
              </p>
              <p className="mt-1 text-xs text-[var(--psc-muted)]">
                Status: <strong className="text-[var(--psc-ink)]">{taxAccount.status ?? "pending"}</strong>
                {taxAccount.due_at ? ` · Due ${new Date(taxAccount.due_at).toLocaleString()}` : ""}
              </p>
              <form
                className="mt-3 flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  run("payments", "tax", () => payFiscalTax(new FormData(e.currentTarget)));
                }}
              >
                <input
                  name="amount"
                  type="number"
                  min={1}
                  step={1}
                  placeholder="Payment amount"
                  className="w-44 border border-[var(--psc-border)] px-2 py-1.5 font-mono"
                />
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded border border-[var(--psc-ink)] bg-[var(--psc-canvas)] px-3 py-1.5 text-xs font-semibold uppercase disabled:opacity-60"
                >
                  Pay tax
                </button>
              </form>
            </>
          ) : (
            <p className="mt-2 text-[var(--psc-muted)]">No assessed tax account yet for this fiscal year.</p>
          )}
        </section>
      ) : null}
      {!economyFrozen && appropriationDeadlineAt && !governmentShutdown ? (
        <p className="text-xs text-[var(--psc-muted)]">
          Appropriations deadline (IRL):{" "}
          <span className="font-mono font-semibold text-[var(--psc-ink)]">
            {new Date(appropriationDeadlineAt).toLocaleString()}
          </span>
          . If the appropriations act is not enrolled by then, the economy shuts down until it passes.
        </p>
      ) : null}
      <section className="grid gap-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 sm:grid-cols-2">
        <div className="sm:col-span-2">{sectionFlash(flash, "balance")}</div>
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

      <EconomyBlackjack economyFrozen={freezeDisabled} />

      <section className="space-y-6 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        {sectionFlash(flash, "ads")}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 max-w-xl">
            <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Campaign ads</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--psc-muted)]">
              TV spots for your races. Spending one ad on an active candidacy adds{" "}
              <span className="font-semibold text-[var(--psc-ink)]">+{CAMPAIGN_AD_POINTS} campaign point</span> to that
              campaign.
            </p>
          </div>
          <div className="flex shrink-0 flex-col rounded-xl border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-5 py-4 text-right shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">In inventory</p>
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums tracking-tight text-[var(--psc-ink)]">{ads}</p>
            <p className="mt-1 text-[11px] text-[var(--psc-muted)]">ready to apply</p>
          </div>
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run("ads", "ads", () => buyCampaignAds(fd));
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-ink)_4%,transparent)] px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Cost each</p>
              <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-[var(--psc-ink)]">
                ${CAMPAIGN_AD_UNIT_PRICE.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-ink)_4%,transparent)] px-4 py-4">
              <label htmlFor="campaign-ad-qty" className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
                How many
              </label>
              <input
                id="campaign-ad-qty"
                name="qty"
                type="number"
                min={1}
                  max={5000}
                  value={adQtyInput}
                onChange={(e) => {
                  setAdQtyInput(e.target.value);
                }}
                  onBlur={() => {
                    const n = Number(adQtyInput);
                    if (!Number.isFinite(n) || n < 1) {
                      setAdQtyInput("1");
                      return;
                    }
                    setAdQtyInput(String(Math.min(5000, Math.floor(n))));
                  }}
                className="mt-2 w-full border border-[var(--psc-border)] bg-white px-3 py-2.5 text-center font-mono text-lg font-semibold tabular-nums text-[var(--psc-ink)] outline-none ring-[var(--psc-accent)] focus:ring-2"
              />
            </div>
            <div className="rounded-xl border border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-accent)_12%,transparent)] px-4 py-4 sm:flex sm:flex-col sm:justify-center">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">You pay</p>
              <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-[var(--psc-ink)]">
                ${adLineTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
              <p className="mt-1 text-[11px] text-[var(--psc-muted)]">{adQty} ad{adQty === 1 ? "" : "s"} × price</p>
            </div>
          </div>
          <button
            type="submit"
            disabled={pending || freezeDisabled}
            className="w-full rounded-lg border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-95 disabled:opacity-60 sm:w-auto sm:min-w-[12rem]"
          >
            Purchase TV ads
          </button>
        </form>

      </section>

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

      <section className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        {sectionFlash(flash, "pac")}
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">PAC</h2>
        {pac ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-[var(--psc-ink)]">
              Your PAC is level <span className="font-mono">{pac.level}</span>.
            </p>
            <p className="text-xs text-[var(--psc-muted)]">
              Current PAC hourly income:{" "}
              <span className="font-mono font-semibold text-[var(--psc-ink)]">
                ${currentPacHourly.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </p>
            {nextPacLevel && nextPacHourly && nextPacUpgradeCost ? (
              <p className="text-xs text-[var(--psc-muted)]">
                Next level (<span className="font-mono">{nextPacLevel}</span>) costs{" "}
                <span className="font-mono font-semibold text-[var(--psc-ink)]">
                  ${nextPacUpgradeCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>{" "}
                and raises hourly income to{" "}
                <span className="font-mono font-semibold text-[var(--psc-ink)]">
                  ${nextPacHourly.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
                .
              </p>
            ) : (
              <p className="text-xs text-[var(--psc-muted)]">You are at max PAC level.</p>
            )}
          </div>
        ) : (
          <button
            type="button"
            disabled={pending || freezeDisabled}
            onClick={() => run("pac", "pac", buyPac)}
            className="rounded border border-[var(--psc-accent)] bg-[var(--psc-accent)]/15 px-4 py-2 text-sm font-semibold text-[var(--psc-ink)] disabled:opacity-60"
          >
            Buy PAC (${PAC_LEVEL_1_COST.toLocaleString()})
          </button>
        )}
        {pac && pac.level < 3 ? (
          <button
            type="button"
            disabled={pending || freezeDisabled}
            onClick={() => run("pac", "up", upgradePac)}
            className="ml-0 rounded border border-[var(--psc-border)] px-4 py-2 text-sm font-semibold disabled:opacity-60 sm:ml-2"
          >
            Upgrade PAC
          </button>
        ) : null}
      </section>

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
