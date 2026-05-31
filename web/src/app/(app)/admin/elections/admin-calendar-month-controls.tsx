import { FormSubmitButton } from "@/components/form-submit-button";
import { advanceSimulationToNextMonth } from "@/app/actions/simulation";

export function AdminCalendarMonthControls({ simDateLabel }: { simDateLabel: string }) {
  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Simulation calendar</h3>
      <p className="mt-1 text-[11px] text-[var(--psc-muted)]">
        Automatic pacing is disabled for baseline ops. Advance the timeline one RP month at a time.
      </p>
      <p className="mt-3 text-xs text-[var(--psc-ink)]">
        Current month: <strong>{simDateLabel}</strong>
      </p>
      <form action={advanceSimulationToNextMonth} className="mt-3">
        <FormSubmitButton
          idleLabel="Advance to next month"
          pendingLabel="Advancing…"
          className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110"
        />
      </form>
    </section>
  );
}
