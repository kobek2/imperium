import {
  advanceFromEconomyStep,
  advanceFromElectionStep,
  completeWelcomeTour,
  finishOrientationFromCityHall,
} from "@/app/actions/orientation";
import { SubmitButton } from "@/components/submit-button";

const shell =
  "rounded-xl border-2 border-[var(--psc-accent)] bg-[color-mix(in_srgb,var(--psc-accent)_8%,var(--psc-panel))] p-5 shadow-sm";

export function OrientationTourPanelElections({ canAdvance }: { canAdvance: boolean }) {
  return (
    <section className={`${shell} space-y-3`} aria-labelledby="orientation-elections-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">
          Guided setup · Step 1 of 3
        </p>
        <span className="text-xs font-semibold text-[var(--psc-ink)]">Elections</span>
      </div>
      <h2 id="orientation-elections-title" className="text-lg font-semibold text-[var(--psc-ink)]">
        Join a race first
      </h2>
      <p className="text-sm text-[var(--psc-muted)]">
        Scroll the list and open a race you are eligible for, then <strong>file as a candidate</strong>.
        Council ward races require your home district (W01–W07) to match the seat; mayor is citywide.
        Continue once you appear on the ballot for any race that is not closed yet — including races
        still in the early filing setup. If there are no such races, you can continue immediately.
        Use <strong>Skip tour</strong> if nothing fits your character yet.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <form action={advanceFromElectionStep}>
          <SubmitButton disabled={!canAdvance} className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:opacity-90">
            I filed — continue to Economy
          </SubmitButton>
        </form>
        <form action={completeWelcomeTour}>
          <SubmitButton
            variant="ghost"
            className="rounded border border-[var(--psc-border)] bg-white px-4 py-2 text-xs font-semibold text-[var(--psc-muted)] hover:bg-[var(--psc-canvas)]"
          >
            Skip tour
          </SubmitButton>
        </form>
      </div>
    </section>
  );
}

export function OrientationTourPanelEconomy({ canAdvance }: { canAdvance: boolean }) {
  return (
    <section className={`${shell} space-y-3`} aria-labelledby="orientation-economy-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">
          Guided setup · Step 2 of 3
        </p>
        <span className="text-xs font-semibold text-[var(--psc-ink)]">Finances</span>
      </div>
      <h2 id="orientation-economy-title" className="text-lg font-semibold text-[var(--psc-ink)]">
        Collect income (Blackjack optional)
      </h2>
      <p className="text-sm text-[var(--psc-muted)]">
        Open <strong>Finances</strong> and use <strong>Collect income</strong> when the timer allows (you need accrual
        time for a payout), or place a <strong>Blackjack</strong> bet — either creates a ledger entry.
        PACs and the stock market live under <strong>Economy</strong>. Then continue to the Mayor&apos;s Office.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <form action={advanceFromEconomyStep}>
          <SubmitButton disabled={!canAdvance} className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:opacity-90">
            I collected — continue to Mayor&apos;s Office
          </SubmitButton>
        </form>
        <form action={completeWelcomeTour}>
          <SubmitButton
            variant="ghost"
            className="rounded border border-[var(--psc-border)] bg-white px-4 py-2 text-xs font-semibold text-[var(--psc-muted)] hover:bg-[var(--psc-canvas)]"
          >
            Skip tour
          </SubmitButton>
        </form>
      </div>
    </section>
  );
}

export function OrientationTourPanelCityHall() {
  return (
    <section className={`${shell} space-y-3`} aria-labelledby="orientation-city-hall-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">
          Guided setup · Step 3 of 3
        </p>
        <span className="text-xs font-semibold text-[var(--psc-ink)]">Mayor&apos;s Office</span>
      </div>
      <h2 id="orientation-city-hall-title" className="text-lg font-semibold text-[var(--psc-ink)]">
        See city hall and the council roster
      </h2>
      <p className="text-sm text-[var(--psc-muted)]">
        Browse department appointments, city budget tools, and the public directory. When you are
        ready, finish and unlock the full site.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <form action={finishOrientationFromCityHall}>
          <SubmitButton className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:opacity-90">
            Finish — go to Home
          </SubmitButton>
        </form>
        <form action={completeWelcomeTour}>
          <SubmitButton
            variant="ghost"
            className="rounded border border-[var(--psc-border)] bg-white px-4 py-2 text-xs font-semibold text-[var(--psc-muted)] hover:bg-[var(--psc-canvas)]"
          >
            Skip tour
          </SubmitButton>
        </form>
      </div>
    </section>
  );
}

/** @deprecated Use OrientationTourPanelCityHall */
export function OrientationTourPanelCongress() {
  return <OrientationTourPanelCityHall />;
}
