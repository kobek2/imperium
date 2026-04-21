"use client";

import { FormSubmitButton } from "@/components/form-submit-button";
import { updateSimulationSettings } from "@/app/actions/simulation";
import type { SimulationSettingsRow } from "@/lib/simulation-calendar";

export function SimulationSettingsForm({ initial }: { initial: SimulationSettingsRow }) {
  const autoSeat = initial.auto_create_seat_elections_on_onboarding ?? false;

  return (
    <div className="space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <h3 className="text-sm font-semibold">RP calendar</h3>
      <p className="text-xs text-[var(--psc-muted)]">
        <strong>Set RP date</strong> is the in-world calendar date that matches <strong>right now</strong> in real
        life. <strong>Calendar speed</strong> is how many RP months pass per real Earth day (fixed pace). Saving
        re-anchors real time to this moment so the timeline does not drift into future years.
      </p>
      <form action={updateSimulationSettings} className="grid max-w-xl gap-3 text-xs">
        <label className="grid gap-1 font-semibold">
          RP calendar date (today in-world)
          <input
            name="rp_anchor_date"
            type="date"
            required
            defaultValue={initial.rp_anchor_date}
            className="border border-[var(--psc-border)] bg-white px-2 py-1 font-normal"
          />
        </label>
        <label className="grid gap-1 font-semibold">
          Calendar speed (RP months per real day)
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
        <label className="flex cursor-pointer items-start gap-2 font-semibold">
          <input
            type="checkbox"
            name="auto_create_seat_elections_on_onboarding"
            defaultChecked={autoSeat}
            value="on"
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span className="font-normal leading-snug text-[var(--psc-ink)]">
            When a player finishes character setup, auto-create House and Senate filing races for their home
            district and state (skips if a race already exists or the seat is taken).
          </span>
        </label>
        <FormSubmitButton
          idleLabel="Save calendar"
          pendingLabel="Saving…"
          className="justify-self-start rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white"
        />
      </form>
    </div>
  );
}
