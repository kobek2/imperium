"use client";

import { useState } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";
import { resetCalendarV2ToJanuary2029AndActivate } from "@/app/actions/simulation";

export function HardResetCalendarForm() {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <form action={resetCalendarV2ToJanuary2029AndActivate} className="mt-2 grid max-w-xl gap-2 text-xs">
      <label className="flex cursor-pointer items-start gap-2 font-semibold">
        <input
          type="checkbox"
          name="confirm_rp_calendar_reset"
          value="1"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          required
          className="mt-0.5 h-4 w-4"
        />
        <span className="font-normal text-[var(--psc-ink)]">
          I understand this wipes the calendar event log and re-bases RP time; production impact is immediate.
        </span>
      </label>
      {!confirmed ? (
        <p className="text-[11px] text-amber-900">Check the box above to enable the reset button.</p>
      ) : null}
      <FormSubmitButton
        disabled={!confirmed}
        idleLabel="Reset calendar + activate (Jan 2029 now)"
        pendingLabel="Resetting…"
        className="justify-self-start rounded border border-rose-900 bg-rose-950 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white"
      />
    </form>
  );
}
