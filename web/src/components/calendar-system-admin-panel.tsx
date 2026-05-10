import { HardResetCalendarForm } from "@/components/hard-reset-calendar-form";
import { FormSubmitButton } from "@/components/form-submit-button";
import { AdminCloseFiscalYearButton } from "@/components/admin-close-fiscal-year-button";
import { adminUnfreezeEconomy } from "@/app/actions/simulation";
import { CALENDAR_EVENT_DEFINITIONS } from "@/lib/calendar-events-registry";

export type RecentCalendarEventRow = {
  id: string;
  event_key: string;
  fired_at: string;
  status: string;
  error_message: string | null;
};

export function CalendarSystemAdminPanel({
  registrySuccessKeys,
  recentCalendarRows,
  canCloseFiscalYear,
  fiscalYearLabel,
}: {
  registrySuccessKeys: Set<string>;
  recentCalendarRows: RecentCalendarEventRow[];
  canCloseFiscalYear: boolean;
  fiscalYearLabel: string;
}) {
  return (
    <div className="space-y-6 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <div className="border-b border-[var(--psc-border)] pb-4">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Calendar hard reset</h3>
        <p className="mt-1 text-[11px] leading-snug text-[var(--psc-muted)]">
          Use after you have <strong className="text-[var(--psc-ink)]">closed elections and seated winners in the DB</strong>{" "}
          and want a clean calendar season: deletes all rows in{" "}
          <code className="font-mono text-[10px]">simulation_calendar_events</code> (success and error), sets{" "}
          <code className="font-mono text-[10px]">simulation_start_at</code> to <strong>right now</strong> so RP resolves to
          the v2 anchor month at fixed pace, enables <code className="font-mono text-[10px]">calendar_is_active</code>, clears{" "}
          <code className="font-mono text-[10px]">last_auto_open_rp_key</code>, then runs one calendar tick (so milestones
          already due can fire again).
        </p>
        <HardResetCalendarForm />
      </div>

      <div className="border-b border-[var(--psc-border)] pb-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Economy emergency</h4>
        <div className="mt-3 space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Close economy</p>
            <div className="mt-2">
              <AdminCloseFiscalYearButton canRun={canCloseFiscalYear} fiscalYearLabel={fiscalYearLabel} />
            </div>
          </div>
          <form action={adminUnfreezeEconomy} className="flex flex-wrap items-end gap-2 text-xs">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" name="confirm_unfreeze" value="1" className="h-4 w-4" />
              Confirm unfreeze
            </label>
            <FormSubmitButton
              idleLabel="Unfreeze economy (admin)"
              pendingLabel="Running…"
              className="rounded border border-rose-800 bg-rose-950 px-2 py-1 text-[11px] font-semibold uppercase text-white"
            />
          </form>
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Event status</h4>
        <p className="mt-1 text-[10px] text-[var(--psc-muted)]">
          “Fired” means at least one <strong className="text-[var(--psc-ink)]">success</strong> row exists for that key.
          Failures appear in the recent log below without marking the milestone complete.
        </p>
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-[11px] text-[var(--psc-ink)]">
          {CALENDAR_EVENT_DEFINITIONS.map((d) => {
            const ok = registrySuccessKeys.has(d.key);
            return (
              <li key={d.key} className="flex justify-between gap-2 border-b border-[var(--psc-border)] py-1">
                <span className="font-mono">{d.key}</span>
                <span className={ok ? "text-emerald-800" : "text-[var(--psc-muted)]"}>{ok ? "fired" : "pending"}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Recent log</p>
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded border border-[var(--psc-border)] bg-white/40 p-2 text-[10px]">
            {recentCalendarRows.length === 0 ? (
              <li className="text-[var(--psc-muted)]">—</li>
            ) : (
              recentCalendarRows.map((r) => {
                const status = r.status ?? "success";
                const err = status === "error";
                return (
                  <li
                    key={r.id}
                    className={`break-words border-b border-[var(--psc-border)]/60 py-1 last:border-0 ${err ? "text-rose-900" : "text-[var(--psc-ink)]"}`}
                  >
                    <span className="font-mono">{r.event_key}</span>
                    <span className="text-[var(--psc-muted)]"> · {status}</span>
                    {err && r.error_message ? (
                      <span className="mt-0.5 block whitespace-pre-wrap text-[10px] leading-snug">{r.error_message}</span>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
