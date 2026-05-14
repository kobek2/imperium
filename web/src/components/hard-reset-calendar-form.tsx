"use client";

import { useState } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";
import { RP_START_YEAR } from "@/lib/simulation-calendar-constants";
import { resetCalendarV2ToRpEpochStartAndActivate } from "@/app/actions/simulation";

export function HardResetCalendarForm() {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <form action={resetCalendarV2ToRpEpochStartAndActivate} className="mt-3 flex max-w-xl flex-col gap-2 text-xs">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          name="confirm_rp_calendar_reset"
          value="1"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          required
          className="h-4 w-4"
        />
        <span className="text-[var(--psc-ink)]">Confirm reset</span>
      </label>
      <FormSubmitButton
        disabled={!confirmed}
        idleLabel={`Reset simulation to Jan ${RP_START_YEAR}`}
        pendingLabel="Resetting…"
        className="justify-self-start rounded border border-rose-900 bg-rose-950 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white"
      />
    </form>
  );
}
