import { FormSubmitButton } from "@/components/form-submit-button";
import { advanceSimulationToNextMonth } from "@/app/actions/simulation";

export function CalendarSystemAdminPanel({
  simDateLabel,
}: {
  simDateLabel: string | null;
}) {
  return (
    <div className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Calendar</h3>
      <p className="mt-1 text-[11px] text-[var(--psc-muted)]">
        Manual mode: automation and hard reset controls are disabled.
      </p>
      <div className="mt-3">
        <dl className="mt-2 space-y-1 text-xs text-[var(--psc-ink)]">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-[var(--psc-muted)]">Simulation date</dt>
            <dd className="font-medium">{simDateLabel ?? "—"}</dd>
          </div>
        </dl>
        <form action={advanceSimulationToNextMonth} className="mt-3">
          <FormSubmitButton
            idleLabel="Advance to next month"
            pendingLabel="Advancing…"
            className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110"
          />
        </form>
      </div>
    </div>
  );
}
