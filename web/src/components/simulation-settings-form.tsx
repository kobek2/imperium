"use client";

import { FormSubmitButton } from "@/components/form-submit-button";
import { syncSimulationRealAnchorToNow, updateSimulationSettings } from "@/app/actions/simulation";
import type { SimulationSettingsRow } from "@/lib/simulation-calendar";

function toLocalInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function SimulationSettingsForm({ initial }: { initial: SimulationSettingsRow }) {
  return (
    <div className="space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <h3 className="text-sm font-semibold">Simulation calendar</h3>
      <p className="text-xs text-[var(--psc-muted)]">
        The simulation calendar advances from real time at{" "}
        <strong>{initial.rp_months_per_real_day} calendar months per real day</strong> (fixed pace),
        plus any admin offset below. The two anchors mean: at the <strong>real</strong> moment you
        choose, the in-world calendar reads the <strong>calendar date</strong> you choose. Each real
        day after that advances the pace above. If you change the calendar date but leave the real
        anchor in the past, the clock can jump many in-world years ahead (for example into the
        2050s).
      </p>
      <form action={syncSimulationRealAnchorToNow} className="flex flex-wrap items-end gap-2">
        <FormSubmitButton
          idleLabel="Set real anchor to right now"
          pendingLabel="Updating…"
          className="rounded border border-amber-800 bg-amber-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-950 hover:bg-amber-100"
        />
        <p className="max-w-md text-[11px] text-[var(--psc-muted)]">
          Keeps your calendar date fields and pace, but re-bases the clock so <strong>this moment</strong>{" "}
          in real life matches the current in-world instant implied by your anchors. Use after changing
          only <span className="font-mono">rp_anchor_date</span> in SQL or when the corner year looks
          wildly off.
        </p>
      </form>
      <form action={updateSimulationSettings} className="grid max-w-xl gap-3 text-xs">
        <label className="grid gap-1 font-semibold">
          Calendar date at anchor (UTC)
          <input
            name="rp_anchor_date"
            type="date"
            required
            defaultValue={initial.rp_anchor_date}
            className="border border-[var(--psc-border)] bg-white px-2 py-1 font-normal"
          />
        </label>
        <label className="grid gap-1 font-semibold">
          Real time at that anchor
          <input
            name="real_anchor_at"
            type="datetime-local"
            required
            defaultValue={toLocalInput(initial.real_anchor_at)}
            className="border border-[var(--psc-border)] bg-white px-2 py-1 font-normal"
          />
        </label>
        <label className="grid gap-1 font-semibold">
          Simulation months per real day
          <input
            name="rp_months_per_real_day"
            type="number"
            step="0.01"
            min="0.01"
            max="366"
            required
            defaultValue={initial.rp_months_per_real_day}
            className="border border-[var(--psc-border)] bg-white px-2 py-1 font-normal"
          />
        </label>
        <label className="grid gap-1 font-semibold">
          Admin month offset (fractional allowed)
          <input
            name="admin_rp_month_offset"
            type="number"
            step="0.01"
            defaultValue={initial.admin_rp_month_offset}
            className="border border-[var(--psc-border)] bg-white px-2 py-1 font-normal"
          />
        </label>
        <label className="flex items-center gap-2 font-semibold">
          <input
            type="checkbox"
            name="auto_open_filings_in_rp_january"
            defaultChecked={initial.auto_open_filings_in_rp_january}
            className="h-4 w-4"
          />
          Auto-open occupied dormant seat filings once per simulation January (runs when an admin
          loads this page)
        </label>
        <FormSubmitButton
          idleLabel="Save calendar settings"
          pendingLabel="Saving…"
          className="justify-self-start rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white"
        />
      </form>
    </div>
  );
}
