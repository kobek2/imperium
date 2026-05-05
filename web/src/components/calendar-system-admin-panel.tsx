import { HardResetCalendarForm } from "@/components/hard-reset-calendar-form";
import { FormSubmitButton } from "@/components/form-submit-button";
import {
  adminUnfreezeEconomy,
  manualFireCalendarEvent,
  setCalendarIsActive,
  unlockSimulationStartForSuperAdmin,
  updateSimulationStartAt,
} from "@/app/actions/simulation";
import { CALENDAR_EVENT_DEFINITIONS } from "@/lib/calendar-events-registry";
import type { SimulationSettingsRow } from "@/lib/simulation-calendar";

export type RecentCalendarEventRow = {
  id: string;
  event_key: string;
  fired_at: string;
  status: string;
  error_message: string | null;
};

export function CalendarSystemAdminPanel({
  settings,
  registrySuccessKeys,
  recentCalendarRows,
}: {
  settings: SimulationSettingsRow;
  registrySuccessKeys: Set<string>;
  recentCalendarRows: RecentCalendarEventRow[];
}) {
  const startVal = settings.simulation_start_at
    ? new Date(String(settings.simulation_start_at)).toISOString().slice(0, 16)
    : "";

  return (
    <div className="space-y-6 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <div>
        <h3 className="text-sm font-semibold">Calendar v2 (fixed pace)</h3>
        <p className="mt-1 text-xs text-[var(--psc-muted)]">
          Pace is hardcoded (48 RP months per 10.5 real days). RP time always begins at{" "}
          <strong>January 2029</strong> at <code className="text-[11px]">simulation_start_at</code>. The engine stays
          idle until <strong>calendar_is_active</strong> is turned on.
        </p>
      </div>

      <form action={updateSimulationStartAt} className="grid max-w-xl gap-2 text-xs">
        <label className="grid gap-1 font-semibold">
          simulation_start_at (ISO, one-time)
          <input
            type="datetime-local"
            name="simulation_start_at"
            defaultValue={startVal}
            className="border border-[var(--psc-border)] bg-white px-2 py-1 font-normal"
          />
        </label>
        <label className="flex cursor-pointer items-start gap-2 font-semibold">
          <input type="checkbox" name="confirm_simulation_start" value="1" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="font-normal">I confirm this is the real-world instant that maps to RP January 2029.</span>
        </label>
        <FormSubmitButton
          idleLabel="Save simulation start"
          pendingLabel="Saving…"
          className="justify-self-start rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white"
        />
      </form>

      <form action={setCalendarIsActive} className="grid max-w-xl gap-2 text-xs">
        <label className="flex cursor-pointer items-start gap-2 font-semibold">
          <input
            type="checkbox"
            name="calendar_is_active"
            defaultChecked={Boolean(settings.calendar_is_active)}
            value="on"
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span className="font-normal text-[var(--psc-ink)]">
            <strong>Activate automated calendar</strong> — inauguration and downstream events run on the next cron
            tick (within ~30 minutes). This should stay off until the live election is fully seated manually.
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 font-semibold">
          <input type="checkbox" name="confirm_calendar_activate" value="1" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="font-normal">I understand this enables the v2 engine and is difficult to undo.</span>
        </label>
        <FormSubmitButton
          idleLabel="Save calendar active flag"
          pendingLabel="Saving…"
          className="justify-self-start rounded border border-amber-900 bg-amber-950 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white"
        />
      </form>

      <form action={unlockSimulationStartForSuperAdmin} className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex cursor-pointer items-center gap-2 font-semibold">
          <input
            type="checkbox"
            name="simulation_start_unlocked"
            defaultChecked={Boolean(settings.simulation_start_unlocked)}
            value="on"
            className="h-4 w-4"
          />
          Allow editing simulation_start_at after lock (super-admin)
        </label>
        <FormSubmitButton
          idleLabel="Save unlock flag"
          pendingLabel="Saving…"
          className="rounded border border-[var(--psc-border)] bg-white px-2 py-1 text-[11px] font-semibold uppercase"
        />
      </form>

      <div className="border-t border-[var(--psc-border)] pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Manual event audit</h4>
        <p className="mt-1 text-[11px] text-[var(--psc-muted)]">
          Logs an audit row (does not run handler logic). Use only for incident notes.
        </p>
        <form action={manualFireCalendarEvent} className="mt-2 flex flex-wrap items-end gap-2">
          <select name="event_key" className="border border-[var(--psc-border)] bg-white px-2 py-1 text-xs">
            {CALENDAR_EVENT_DEFINITIONS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.key}
              </option>
            ))}
          </select>
          <FormSubmitButton
            idleLabel="Log manual touch"
            pendingLabel="Logging…"
            className="rounded border border-[var(--psc-border)] bg-white px-2 py-1 text-[11px] font-semibold uppercase"
          />
        </form>
      </div>

      <div className="border-t border-[var(--psc-border)] pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-rose-900">Hard reset — RP January 2029</h4>
        <p className="mt-1 text-[11px] leading-snug text-[var(--psc-muted)]">
          Use after you have <strong className="text-[var(--psc-ink)]">closed elections and seated winners in the DB</strong>{" "}
          and want a clean calendar season: deletes all rows in <code className="font-mono">simulation_calendar_events</code>{" "}
          (success and error), sets <code className="font-mono">simulation_start_at</code> to <strong>right now</strong> so RP
          resolves to <strong>January 2029</strong> at the fixed pace, enables <code className="font-mono">calendar_is_active</code>, clears{" "}
          <code className="font-mono">last_auto_open_rp_key</code>, then runs one calendar tick (so{" "}
          <code className="font-mono">inauguration_2029</code> and anything else already due can fire again).
        </p>
        <HardResetCalendarForm />
      </div>

      <div className="border-t border-[var(--psc-border)] pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Economy emergency</h4>
        <form action={adminUnfreezeEconomy} className="mt-2 flex flex-wrap items-end gap-2 text-xs">
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

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Event status</h4>
        <p className="mt-1 text-[10px] text-[var(--psc-muted)]">
          “Fired” means at least one <strong className="text-[var(--psc-ink)]">success</strong> row exists for that
          key. Failures appear in the recent log below without marking the milestone complete.
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
