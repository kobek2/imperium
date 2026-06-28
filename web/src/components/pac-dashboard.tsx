"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { contributePacToCandidate, fundPacTreasury, registerPac } from "@/app/actions/economy";
import { NavRouteButton } from "@/components/nav-route-button";
import type { PacCandidateFundingSummary } from "@/lib/business-data";
import {
  PAC_DOLLARS_PER_POINT,
  PAC_LEGAL_CAP_PER_CANDIDATE,
  PAC_MIN_CONTRIBUTION,
  PAC_MIN_FOR_ONE_POINT,
  PAC_REGISTER_COST,
  pacCampaignPointsFromAmount,
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

export type PacStateOption = {
  code: string;
  name: string;
};

function formatMoney(n: number | null | undefined): string {
  return `$${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function PacDashboard({
  pacStatus,
  contributionTargets,
  fundingSummaries,
  states,
  generalElectionOpen,
  economyFrozen,
}: {
  pacStatus: PacStatus;
  contributionTargets: PacContributionTarget[];
  fundingSummaries: PacCandidateFundingSummary[];
  states: PacStateOption[];
  generalElectionOpen: boolean;
  economyFrozen: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);
  const [pacName, setPacName] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [contribAmount, setContribAmount] = useState("250000");
  const [contribTarget, setContribTarget] = useState("");
  const [contribState, setContribState] = useState("");

  const hasPac = pacStatus.has_pac;
  const treasury = Number(pacStatus.treasury_balance ?? 0);
  const registerCost = PAC_REGISTER_COST;
  const contribAmt = Number(contribAmount);
  const parsedContrib = Number.isFinite(contribAmt) ? contribAmt : 0;
  const previewPts = pacCampaignPointsFromAmount(parsedContrib);

  const targetByKey = useMemo(
    () => new Map(contributionTargets.map((t) => [`${t.electionId}__${t.candidateId}`, t])),
    [contributionTargets],
  );
  const fundingByKey = useMemo(
    () => new Map(fundingSummaries.map((s) => [`${s.electionId}__${s.candidateId}`, s])),
    [fundingSummaries],
  );

  const selectedTarget = contribTarget ? targetByKey.get(contribTarget) : undefined;
  const selectedFunding = contribTarget ? fundingByKey.get(contribTarget) : undefined;
  const isPresident = selectedTarget?.office === "president";
  const activeFundingSummaries = fundingSummaries.filter((s) => s.disclosedTotal > 0);
  const canContribute = generalElectionOpen && contributionTargets.length > 0;

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
            Deposit as much as you want into your PAC treasury from your wallet. Disclosed spending converts treasury
            funds into campaign points for open general-election races.
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
              <p className="mt-1 text-xs text-[var(--psc-muted)]">No deposit limit — fund from your wallet anytime.</p>
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

          {activeFundingSummaries.length > 0 ? (
            <article className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-canvas)]/40 p-4">
              <h3 className="font-semibold">Candidate funding from your PAC</h3>
              <p className="mt-1 text-xs text-[var(--psc-muted)]">
                Each candidate can receive up to {formatMoney(PAC_LEGAL_CAP_PER_CANDIDATE)} in disclosed contributions
                from your PAC for a given race.
              </p>
              <ul className="mt-3 space-y-3">
                {activeFundingSummaries.map((s) => (
                  <li key={`${s.electionId}__${s.candidateId}`} className="rounded border border-[var(--psc-border)]/70 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{s.label}</span>
                      <span className="font-mono tabular-nums text-[var(--psc-muted)]">
                        {formatMoney(s.disclosedTotal)} received · {formatMoney(s.remaining)} left
                      </span>
                    </div>
                    {s.office === "president" && s.byState.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs text-[var(--psc-muted)]">
                        {s.byState.map((row) => (
                          <li key={row.state} className="flex justify-between gap-2">
                            <span>{row.state}</span>
                            <span className="font-mono tabular-nums">
                              {formatMoney(row.amount)} → +{row.points} pts
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </article>
          ) : null}

          <article className="rounded-xl border border-[var(--psc-border)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Contribute to candidate</h3>
                <p className="mt-0.5 text-xs text-[var(--psc-muted)]">General election only — not available during filing or primary.</p>
              </div>
              {generalElectionOpen ? (
                <span className="rounded-full border border-[var(--psc-border)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--psc-ink)]">
                  General open
                </span>
              ) : (
                <span className="rounded-full border border-[var(--psc-border)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--psc-muted)]">
                  General closed
                </span>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Points rate</p>
                <p className="mt-1 text-sm font-semibold">+1 per {formatMoney(PAC_DOLLARS_PER_POINT)}</p>
                <p className="mt-0.5 text-xs text-[var(--psc-muted)]">Rounded down</p>
              </div>
              <div className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Per candidate</p>
                <p className="mt-1 text-sm font-semibold">{formatMoney(PAC_LEGAL_CAP_PER_CANDIDATE)} max</p>
                <p className="mt-0.5 text-xs text-[var(--psc-muted)]">From your PAC per race</p>
              </div>
              <div className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">House &amp; Senate</p>
                <p className="mt-1 text-sm font-semibold">National score</p>
                <p className="mt-0.5 text-xs text-[var(--psc-muted)]">Boosts campaign points</p>
              </div>
              <div className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">President</p>
                <p className="mt-1 text-sm font-semibold">State-targeted</p>
                <p className="mt-0.5 text-xs text-[var(--psc-muted)]">Pick a state to spend in</p>
              </div>
            </div>

            {!generalElectionOpen ? (
              <p className="mt-4 rounded-xl border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 px-4 py-3 text-sm text-[var(--psc-muted)]">
                No races are in the general election right now. Fund your treasury anytime — contributions unlock once
                races move to general. See{" "}
                <NavRouteButton href="/elections" className="inline-flex px-1 py-0 text-xs">
                  Elections
                </NavRouteButton>{" "}
                for current phases.
              </p>
            ) : contributionTargets.length === 0 ? (
              <p className="mt-4 rounded-xl border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 px-4 py-3 text-sm text-[var(--psc-muted)]">
                General elections are open, but there are no eligible candidates to support yet. Nominees appear here
                once primaries finish.
              </p>
            ) : (
              <form
                className="mt-4 space-y-3 border-t border-[var(--psc-border)]/60 pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  run(() => contributePacToCandidate(fd));
                }}
              >
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Candidate</span>
                  <select
                    name="candidacy"
                    value={contribTarget}
                    onChange={(e) => {
                      setContribTarget(e.target.value);
                      setContribState("");
                    }}
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
                </label>
                {isPresident ? (
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">Target state</span>
                    <select
                      name="target_state"
                      value={contribState}
                      onChange={(e) => setContribState(e.target.value)}
                      required
                      className="w-full border border-[var(--psc-border)] px-3 py-2 text-sm"
                    >
                      <option value="">Select state…</option>
                      {states.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.name} ({s.code})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {selectedFunding ? (
                  <p className="text-xs text-[var(--psc-muted)]">
                    Received {formatMoney(selectedFunding.disclosedTotal)} · {formatMoney(selectedFunding.remaining)}{" "}
                    still available for this candidate
                  </p>
                ) : null}
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Amount</span>
                  <input
                    name="amount"
                    value={contribAmount}
                    onChange={(e) => setContribAmount(e.target.value)}
                    type="number"
                    min={PAC_MIN_CONTRIBUTION}
                    step={PAC_DOLLARS_PER_POINT}
                    className="w-full border border-[var(--psc-border)] px-3 py-2 font-mono text-sm"
                  />
                </label>
                <p className="text-xs text-[var(--psc-muted)]">
                  +{previewPts} campaign point{previewPts === 1 ? "" : "s"}
                  {previewPts < 1 ? ` · need at least ${formatMoney(PAC_MIN_FOR_ONE_POINT)} for 1 point` : ""}
                  {selectedFunding ? (
                    <>
                      {" "}
                      · {formatMoney(Math.max(0, selectedFunding.remaining - parsedContrib))} left after this
                    </>
                  ) : null}
                </p>
                <button
                  type="submit"
                  disabled={pending || economyFrozen || !canContribute}
                  className="w-full rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Contribute
                </button>
              </form>
            )}
          </article>
        </>
      )}
    </section>
  );
}
