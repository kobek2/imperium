"use client";

import { FormSubmitButton } from "@/components/form-submit-button";
import { updateSimulationSettings } from "@/app/actions/simulation";
import type { SimulationSettingsRow } from "@/lib/simulation-calendar";

export function SimulationSettingsForm({ initial }: { initial: SimulationSettingsRow }) {
  const autoSeat = initial.auto_create_seat_elections_on_onboarding ?? false;
  const autoJan = initial.auto_open_filings_in_rp_january ?? false;

  return (
    <div className="space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <h3 className="text-sm font-semibold">Legacy automation (pre–calendar v2)</h3>
      <p className="text-xs text-[var(--psc-muted)]">
        RP pace and manual RP date controls were removed. Use the <strong>Calendar v2</strong> panel below for the new
        fixed-pace engine. These toggles still apply until the automated calendar is activated.
      </p>
      <form action={updateSimulationSettings} className="grid max-w-xl gap-3 text-xs">
        <label className="flex cursor-pointer items-start gap-2 font-semibold">
          <input
            type="checkbox"
            name="auto_open_filings_in_rp_january"
            defaultChecked={autoJan}
            value="on"
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span className="font-normal leading-snug text-[var(--psc-ink)]">
            RP January: create missing House/Senate seat rows when needed, then auto-open dormant filings when someone’s
            profile lists that district or state (deduped per RP month).
          </span>
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
            When a player finishes character setup, auto-create House and Senate filing races for their home district
            and state.
          </span>
        </label>
        <FormSubmitButton
          idleLabel="Save automation toggles"
          pendingLabel="Saving…"
          className="justify-self-start rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white"
        />
      </form>
    </div>
  );
}
