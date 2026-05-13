import { HardResetCalendarForm } from "@/components/hard-reset-calendar-form";
import { AdminSimulationEconomyButtons } from "@/components/admin-simulation-economy-buttons";
import { RP_MONTHS_PER_REAL_DAY } from "@/lib/simulation-calendar-constants";

export function CalendarSystemAdminPanel({
  canCloseFiscalYear,
  canStartAppropriationsClock,
  fiscalYearLabel,
  simDateLabel,
}: {
  canCloseFiscalYear: boolean;
  canStartAppropriationsClock: boolean;
  fiscalYearLabel: string;
  simDateLabel: string | null;
}) {
  const paceRounded = Math.round(RP_MONTHS_PER_REAL_DAY * 10) / 10;

  return (
    <div className="space-y-6 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <div className="border-b border-[var(--psc-border)] pb-4">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Simulation reset</h3>
        <HardResetCalendarForm />
      </div>

      <div className="border-b border-[var(--psc-border)] pb-4">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Economy</h3>
        <div className="mt-3">
          <AdminSimulationEconomyButtons
            canCloseFiscalYear={canCloseFiscalYear}
            canStartAppropriationsClock={canStartAppropriationsClock}
            fiscalYearLabel={fiscalYearLabel}
          />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Calendar</h3>
        <dl className="mt-2 space-y-1 text-xs text-[var(--psc-ink)]">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-[var(--psc-muted)]">Pace</dt>
            <dd>~{paceRounded} simulation months per real day</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-[var(--psc-muted)]">Simulation date</dt>
            <dd className="font-medium">{simDateLabel ?? "—"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
