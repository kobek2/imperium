"use client";

import { FormSubmitButton } from "@/components/form-submit-button";
import { openSeatElectionFiling } from "@/app/actions/simulation";

export function OpenSeatFilingForm({ electionId }: { electionId: string }) {
  return (
    <form action={openSeatElectionFiling} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="election_id" value={electionId} />
      <FormSubmitButton
        idleLabel="Open filing window (24h + 24h + 24h)"
        pendingLabel="Opening…"
        className="rounded border border-amber-900 bg-amber-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white"
      />
      <p className="max-w-xl text-[11px] text-amber-950">
        Starts a fresh three-day schedule from now. House: vacates any representative whose home
        district matches this seat. Senate: vacates the last certified winner of this same class
        (if any) so they must re-file to defend the seat.
      </p>
    </form>
  );
}
