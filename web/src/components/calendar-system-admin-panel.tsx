import { HardResetCalendarForm } from "@/components/hard-reset-calendar-form";
import { AdminSimulationEconomyButtons } from "@/components/admin-simulation-economy-buttons";
import { FormSubmitButton } from "@/components/form-submit-button";
import { setCalendarAutoCongressElections } from "@/app/actions/simulation";
import { RP_MONTHS_PER_REAL_DAY } from "@/lib/simulation-calendar-constants";

export function CalendarSystemAdminPanel({
  canCloseFiscalYear,
  canStartAppropriationsClock,
  fiscalYearLabel,
  simDateLabel,
  canManageCalendarAutomation,
  calendarAutoCongressElections,
}: {
  canCloseFiscalYear: boolean;
  canStartAppropriationsClock: boolean;
  fiscalYearLabel: string;
  simDateLabel: string | null;
  canManageCalendarAutomation: boolean;
  calendarAutoCongressElections: boolean;
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
        {canManageCalendarAutomation ? (
          <form action={setCalendarAutoCongressElections} className="mt-4 space-y-2 rounded border border-[var(--psc-border)] bg-[var(--psc-bg)] p-3">
            <p className="text-[11px] font-medium text-[var(--psc-ink)]">Congress and election automation</p>
            <p className="text-[10px] leading-snug text-[var(--psc-muted)]">
              When off, calendar ticks and normal page loads do not advance election phases, leadership session windows,
              or open or seat federal races from the schedule. Budget-cycle calendar steps still run. Player actions
              (votes, filings) still apply schedule updates for that session.
            </p>
            <label className="flex cursor-pointer items-start gap-2 text-[11px] text-[var(--psc-ink)]">
              <input
                type="checkbox"
                name="calendar_auto_congress_elections"
                value="on"
                defaultChecked={calendarAutoCongressElections}
                className="mt-0.5"
              />
              <span>Enable automatic congress, leadership, and election phase behavior from the calendar</span>
            </label>
            <FormSubmitButton
              idleLabel="Save automation setting"
              pendingLabel="Saving…"
              className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-ink)] hover:bg-[var(--psc-border)]/30"
            />
          </form>
        ) : (
          <p className="mt-3 text-[10px] text-[var(--psc-muted)]">
            Automatic congress / election schedule:{" "}
            <span className="font-medium text-[var(--psc-ink)]">{calendarAutoCongressElections ? "on" : "off"}</span>
            {" "}(admin only to change)
          </p>
        )}
      </div>
    </div>
  );
}
