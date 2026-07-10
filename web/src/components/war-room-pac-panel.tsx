"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { contributePacToCandidate, fundPacTreasury } from "@/app/actions/economy";
import type { PacContributionTarget } from "@/components/pac-dashboard";
import type { PacCandidateFundingSummary } from "@/lib/business-data";
import {
  PAC_DOLLARS_PER_POINT,
  PAC_LEGAL_CAP_PER_CANDIDATE,
  PAC_MIN_CONTRIBUTION,
  pacCampaignPointsFromAmount,
} from "@/lib/economy-config";
import type { CampaignActionResult } from "@/app/actions/campaign-manager";

function formatMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function WarRoomPacPanel({
  treasury,
  pacName,
  targets,
  fundingSummaries,
  states,
  generalElectionOpen,
  economyFrozen,
  electionsWindow,
  isStrategist,
}: {
  treasury: number;
  pacName: string | null;
  targets: PacContributionTarget[];
  fundingSummaries: PacCandidateFundingSummary[];
  states: Array<{ code: string; name: string }>;
  generalElectionOpen: boolean;
  economyFrozen: boolean;
  electionsWindow: boolean;
  isStrategist: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<CampaignActionResult | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [contribAmount, setContribAmount] = useState("750000");
  const [contribTarget, setContribTarget] = useState("");
  const [contribState, setContribState] = useState("");

  const targetByKey = useMemo(
    () => new Map(targets.map((t) => [`${t.electionId}__${t.candidateId}`, t])),
    [targets],
  );
  const fundingByKey = useMemo(
    () => new Map(fundingSummaries.map((s) => [`${s.electionId}__${s.candidateId}`, s])),
    [fundingSummaries],
  );

  const selectedTarget = contribTarget ? targetByKey.get(contribTarget) : undefined;
  const selectedFunding = contribTarget ? fundingByKey.get(contribTarget) : undefined;
  const isMayorRace = selectedTarget?.office === "mayor" || selectedTarget?.office === "president";
  const parsedContrib = Number(contribAmount);
  const previewPts = pacCampaignPointsFromAmount(Number.isFinite(parsedContrib) ? parsedContrib : 0);

  const canContribute =
    isStrategist && electionsWindow && generalElectionOpen && targets.length > 0 && !economyFrozen;

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      setFlash(null);
      const r = await fn();
      setFlash(r);
      if (r.ok) router.refresh();
    });
  }

  if (!isStrategist) {
    return (
      <p className="text-sm text-[var(--psc-muted)]">Enroll as party strategist to control PAC spending from here.</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">PAC treasury</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(treasury)}</p>
          {pacName ? <p className="text-xs text-[var(--psc-muted)]">{pacName}</p> : null}
        </div>
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Rate</p>
          <p className="mt-1 text-sm font-semibold">+1 pt / {formatMoney(PAC_DOLLARS_PER_POINT)}</p>
        </div>
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Cap / candidate</p>
          <p className="mt-1 text-sm font-semibold">{formatMoney(PAC_LEGAL_CAP_PER_CANDIDATE)}</p>
        </div>
      </div>

      {!electionsWindow ? (
        <p className="rounded border border-dashed border-[var(--psc-border)] px-3 py-2 text-sm text-[var(--psc-muted)]">
          PAC contributions unlock during <strong>election turns</strong> (turns 6–15 each cycle). Use council session
          turns for ordinances.
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--psc-muted)]">
          Deposit from wallet
          <input
            type="number"
            min={1}
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            className="mt-1 block w-40 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-2 py-1.5 text-sm"
            placeholder="Amount"
          />
        </label>
        <button
          type="button"
          disabled={pending || economyFrozen}
          onClick={() => {
            const fd = new FormData();
            fd.set("amount", depositAmount);
            run(() => fundPacTreasury(fd));
          }}
          className="rounded border border-[var(--psc-border)] px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Fund PAC
        </button>
      </div>

      <div className="rounded border border-[var(--psc-border)] p-4">
        <h4 className="font-semibold">Disburse to slate</h4>
        <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
          The rival AI watches these filings and counter-spends within minutes.
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <label className="block text-xs text-[var(--psc-muted)]">
            Candidate
            <select
              value={contribTarget}
              onChange={(e) => setContribTarget(e.target.value)}
              className="mt-1 block w-full rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-2 py-1.5 text-sm"
            >
              <option value="">Select…</option>
              {targets.map((t) => (
                <option key={`${t.electionId}__${t.candidateId}`} value={`${t.electionId}__${t.candidateId}`}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {isMayorRace ? (
            <label className="block text-xs text-[var(--psc-muted)]">
              Target state
              <select
                value={contribState}
                onChange={(e) => setContribState(e.target.value)}
                className="mt-1 block w-full rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-2 py-1.5 text-sm"
              >
                <option value="">Select state…</option>
                {states.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block text-xs text-[var(--psc-muted)]">
            Amount (min {formatMoney(PAC_MIN_CONTRIBUTION)})
            <input
              type="number"
              min={PAC_MIN_CONTRIBUTION}
              step={250000}
              value={contribAmount}
              onChange={(e) => setContribAmount(e.target.value)}
              className="mt-1 block w-full rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        {selectedFunding ? (
          <p className="mt-2 text-xs text-[var(--psc-muted)]">
            Already disclosed {formatMoney(selectedFunding.disclosedTotal)} · {formatMoney(selectedFunding.remaining)}{" "}
            remaining
          </p>
        ) : null}
        <p className="mt-1 text-xs text-[var(--psc-muted)]">Preview: +{previewPts} campaign points</p>
        <button
          type="button"
          disabled={pending || !canContribute || !contribTarget}
          onClick={() => {
            const fd = new FormData();
            fd.set("candidacy", contribTarget);
            fd.set("amount", contribAmount);
            if (isMayorRace && contribState) fd.set("target_state", contribState);
            run(() => contributePacToCandidate(fd));
          }}
          className="mt-3 rounded bg-[var(--psc-seal)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          File PAC expenditure
        </button>
      </div>

      {flash ? (
        <p className={`text-sm ${flash.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
          {flash.message}
        </p>
      ) : null}
    </div>
  );
}
