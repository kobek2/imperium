"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { contributePacToCandidate, fundPacTreasury, registerPac } from "@/app/actions/economy";
import { NavRouteButton } from "@/components/nav-route-button";
import {
  PAC_LEGAL_CAP_PER_CANDIDATE,
  PAC_LEGAL_POINTS_PER_500K,
  PAC_MIN_CONTRIBUTION,
  PAC_REGISTER_COST,
} from "@/lib/economy-config";

export type PacStatus = {
  has_pac: boolean;
  pac_name?: string;
  treasury_balance?: number;
};

export type PacContributionTarget = {
  electionId: string;
  candidateId: string;
  label: string;
  office: string;
};

function formatMoney(n: number | null | undefined): string {
  return `$${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function legalPtsPreview(amount: number): number {
  return Math.floor(Math.max(0, amount) / 500_000) * PAC_LEGAL_POINTS_PER_500K;
}

export function PacDashboard({
  pacStatus,
  contributionTargets,
  economyFrozen,
}: {
  pacStatus: PacStatus;
  contributionTargets: PacContributionTarget[];
  economyFrozen: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);
  const [pacName, setPacName] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [contribAmount, setContribAmount] = useState("500000");
  const [contribTarget, setContribTarget] = useState("");

  const hasPac = pacStatus.has_pac;
  const treasury = Number(pacStatus.treasury_balance ?? 0);
  const registerCost = PAC_REGISTER_COST;
  const contribAmt = Number(contribAmount);
  const parsedContrib = Number.isFinite(contribAmt) ? contribAmt : 0;

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      setFlash(null);
      const r = await fn();
      setFlash(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <section className="space-y-6 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Your PAC</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--psc-muted)]">
            Treasury is separate from your wallet. Disclosed contributions convert treasury funds into campaign points
            for general-election races.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NavRouteButton href="/elections">Elections</NavRouteButton>
          <NavRouteButton href="/economy/stocks">Stock market</NavRouteButton>
        </div>
      </div>

      {flash ? (
        <div
          role="status"
          className={`rounded border px-3 py-2 text-sm ${
            flash.ok ? "border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-ink)_4%,transparent)]" : "border-rose-300 bg-rose-50 text-rose-950"
          }`}
        >
          {flash.message}
        </div>
      ) : null}

      {!hasPac ? (
        <article className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Register PAC</p>
          <h3 className="mt-1 text-lg font-semibold">{formatMoney(registerCost)}</h3>
          <form
            className="mt-4 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              run(() => registerPac(fd));
            }}
          >
            <input
              name="pac_name"
              value={pacName}
              onChange={(e) => setPacName(e.target.value)}
              placeholder="PAC name"
              minLength={3}
              required
              className="w-full border border-[var(--psc-border)] px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={pending || economyFrozen}
              className="w-full rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Register PAC
            </button>
          </form>
        </article>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">PAC</p>
              <p className="mt-1 font-semibold">{pacStatus.pac_name}</p>
            </div>
            <div className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Treasury</p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{formatMoney(treasury)}</p>
            </div>
          </div>

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              run(() => fundPacTreasury(fd));
            }}
          >
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Fund treasury from wallet</span>
              <input
                name="amount"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                type="number"
                min={1}
                placeholder="Amount"
                className="w-40 border border-[var(--psc-border)] px-3 py-2 font-mono text-sm"
              />
            </label>
            <button type="submit" disabled={pending || economyFrozen} className="rounded border border-[var(--psc-ink)] px-4 py-2 text-sm font-semibold disabled:opacity-60">
              Deposit
            </button>
          </form>

          <article className="rounded-xl border border-[var(--psc-border)] p-4">
            <h3 className="font-semibold">Contribute to candidate</h3>
            <p className="mt-1 text-xs text-[var(--psc-muted)]">
              Disclosed cap {formatMoney(PAC_LEGAL_CAP_PER_CANDIDATE)} per candidate · $500K per campaign point.
            </p>
            {contributionTargets.length === 0 ? (
              <p className="mt-3 rounded border border-dashed border-[var(--psc-border)] px-3 py-3 text-sm text-[var(--psc-muted)]">
                No open general-election candidates to support right now. Check{" "}
                <NavRouteButton href="/elections" className="inline-flex px-1 py-0 text-xs">
                  Elections
                </NavRouteButton>{" "}
                for race phases.
              </p>
            ) : null}
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                run(() => contributePacToCandidate(fd));
              }}
            >
              <select
                name="candidacy"
                value={contribTarget}
                onChange={(e) => setContribTarget(e.target.value)}
                required
                className="w-full border border-[var(--psc-border)] px-3 py-2 text-sm"
              >
                <option value="">Select candidate…</option>
                {contributionTargets.map((t) => (
                  <option key={`${t.electionId}__${t.candidateId}`} value={`${t.electionId}__${t.candidateId}`}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                name="amount"
                value={contribAmount}
                onChange={(e) => setContribAmount(e.target.value)}
                type="number"
                min={PAC_MIN_CONTRIBUTION}
                step={100000}
                className="w-full border border-[var(--psc-border)] px-3 py-2 font-mono text-sm"
              />
              <p className="text-xs text-[var(--psc-muted)]">Preview: +{legalPtsPreview(parsedContrib)} campaign points</p>
              <button type="submit" disabled={pending || economyFrozen || contributionTargets.length === 0} className="w-full rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                Contribute
              </button>
            </form>
          </article>
        </>
      )}
    </section>
  );
}
