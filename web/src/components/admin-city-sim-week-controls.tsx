"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  advanceCityCyclePhaseAction,
  advanceCityElectionTrackAction,
  advanceCityElectionWaveAction,
  jumpCityCyclePhaseAction,
  openCityElectionsNowAction,
  openClassBElectionsNowAction,
  runCitySchedulerTickAction,
  type AdvanceCitySimWeekResult,
} from "@/app/actions/city-sim-week";
import {
  CITY_BUDGET_CYCLE_YEARS,
  CITY_CYCLE_HOURS,
  cyclePhaseLabel,
  formatCitySimWeek,
  formatElectionWaveLabel,
  nextElectionStepHint,
  type CityCyclePhase,
  type CitySimWeekStatus,
} from "@/lib/city-sim-week";

const PHASES: CityCyclePhase[] = ["sign_ups_open", "primaries", "generals", "legislative"];

function btnClass(disabled: boolean) {
  return `rounded-md border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2.5 py-1.5 text-xs font-semibold text-[var(--psc-ink)] transition hover:border-[var(--psc-accent)] disabled:cursor-not-allowed disabled:opacity-50`;
}

export function AdminCitySimWeekControls({
  status,
  canDev,
}: {
  status: CitySimWeekStatus;
  canDev: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<AdvanceCitySimWeekResult>) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setMessage(result.message);
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-[var(--psc-ink)]">City sim</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--psc-muted)]">
        Biennium cycle ({CITY_BUDGET_CYCLE_YEARS} sim years / {CITY_CYCLE_HOURS}h IRL): Wave 1 =
        mayor + Class A council (W01–W04) · Wave 2 = Class B council (W05–W07) at mid-cycle ·
        then legislative session and the next biennium.
      </p>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Current</dt>
          <dd className="mt-0.5 font-semibold text-[var(--psc-ink)]">
            {formatCitySimWeek(status)} · Biennium {status.bienniumIndex}
          </dd>
          <dd className="text-xs text-[var(--psc-muted)]">
            {cyclePhaseLabel(status.cyclePhase)} · tick {status.simTick}
            <br />
            <span className="font-medium text-[var(--psc-ink)]">{formatElectionWaveLabel(status)}</span>
          </dd>
        </div>
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Gates</dt>
          <dd className="mt-0.5 text-xs text-[var(--psc-muted)]">
            Budget propose: {status.budgetProposalOpen ? "open" : "closed"}
            <br />
            Budget enacted: {status.budgetEnacted ? "yes" : "no"}
            {" · "}
            Budget passed council: {status.budgetPassed ? "yes" : "no"}
            <br />
            Ordinances: {status.ordinancesAllowed ? "allowed" : "blocked"}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Link href="/mayor" className={btnClass(false)}>
          Mayor office →
        </Link>
        <Link href="/council" className={btnClass(false)}>
          City Council →
        </Link>
        <Link href="/elections" className={btnClass(false)}>
          Elections →
        </Link>
      </div>

      {canDev ? (
        <div className="mt-4 space-y-3 border-t border-[var(--psc-border)] pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Dev controls (staff operator)
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-[var(--psc-accent)] bg-[var(--psc-accent)] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={pending}
              onClick={() => run(advanceCityElectionWaveAction)}
              title={nextElectionStepHint(status)}
            >
              Next election step →
            </button>
            <button
              type="button"
              className={btnClass(pending)}
              disabled={pending}
              onClick={() => run(advanceCityCyclePhaseAction)}
            >
              Next cycle phase
            </button>
            <button
              type="button"
              className={btnClass(pending)}
              disabled={pending}
              onClick={() => run(advanceCityElectionTrackAction)}
            >
              Advance all city races
            </button>
            <button
              type="button"
              className={btnClass(pending)}
              disabled={pending}
              onClick={() => run(runCitySchedulerTickAction)}
            >
              Run scheduler tick
            </button>
          </div>

          <p className="text-[10px] text-[var(--psc-muted)]">{nextElectionStepHint(status)}</p>

          <details className="text-[11px] text-[var(--psc-muted)]">
            <summary className="cursor-pointer font-semibold text-[var(--psc-ink)]">Manual wave overrides</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={btnClass(pending)}
                disabled={pending}
                onClick={() => run(openCityElectionsNowAction)}
              >
                Open Wave 1 only
              </button>
              <button
                type="button"
                className={btnClass(pending)}
                disabled={pending}
                onClick={() => run(openClassBElectionsNowAction)}
              >
                Open Wave 2 only
              </button>
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-[var(--psc-muted)]">Jump to:</span>
            {PHASES.map((phase) => (
              <button
                key={phase}
                type="button"
                className={btnClass(pending)}
                disabled={pending}
                onClick={() => run(() => jumpCityCyclePhaseAction(phase))}
              >
                {cyclePhaseLabel(phase)}
              </button>
            ))}
          </div>

          <p className="text-[10px] leading-relaxed text-[var(--psc-muted)]">
            <strong className="text-[var(--psc-ink)]">Next election step</strong> walks the biennium:
            Biennium 1 Wave 1 (Year 1) → Wave 2 (Year 2) → Biennium 2 Wave 1 (Year 3), opening races and
            advancing phases. Use <strong className="text-[var(--psc-ink)]">Next cycle phase</strong> for
            budget/legislative timing. Jump to Legislative for ordinances after elections.
          </p>

          {message ? (
            <p className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-900">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 border-t border-[var(--psc-border)] pt-3 text-[11px] text-[var(--psc-muted)]">
          Dev phase controls require <span className="font-mono">admin</span> or{" "}
          <span className="font-mono">staff_super</span>.
        </p>
      )}
    </section>
  );
}
