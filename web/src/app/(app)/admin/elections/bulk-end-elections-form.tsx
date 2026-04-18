"use client";

import { useFormStatus } from "react-dom";
import { bulkEndElections } from "@/app/actions/elections";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-rose-900/40 bg-rose-950/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-rose-100 hover:bg-rose-900/50 disabled:opacity-50"
    >
      {pending ? "Ending…" : "End selected races"}
    </button>
  );
}

export function BulkEndElectionsForm() {
  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">End all (by office)</h3>
        <p className="max-w-xl text-xs text-[var(--psc-muted)]">
          Closes every non-closed seat race for the offices you check. Uses the same rules as setting
          phase to Closed on each race (primary winners if needed, then general winner).
        </p>
      </div>
      <form action={bulkEndElections} className="flex flex-wrap items-end gap-4">
        <fieldset className="flex flex-wrap gap-4 border-0 p-0">
          <legend className="sr-only">Offices to end</legend>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--psc-ink)]">
            <input type="checkbox" name="end_house" value="1" className="h-4 w-4" />
            House
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--psc-ink)]">
            <input type="checkbox" name="end_senate" value="1" className="h-4 w-4" />
            Senate
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--psc-ink)]">
            <input type="checkbox" name="end_president" value="1" className="h-4 w-4" />
            President
          </label>
        </fieldset>
        <SubmitButton />
      </form>
    </section>
  );
}
