"use client";

import { useFormStatus } from "react-dom";
import { bulkEndElections } from "@/app/actions/elections";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-rose-900/40 bg-rose-950/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-rose-100 hover:bg-rose-900/50 disabled:opacity-50"
    >
      {pending ? "Ending…" : label}
    </button>
  );
}

export function BulkEndElectionsForm() {
  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">End all (by office)</h3>
        <p className="max-w-xl text-xs text-[var(--psc-muted)]">
          Closes every non-closed race for those offices (same rules as setting phase to Closed on each
          race: primary winners if needed, then general winner). Does not include leadership-election rows
          tied to <code className="font-mono text-[11px]">leadership_role</code>.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <form action={bulkEndElections} className="inline">
          <input type="hidden" name="end_house" value="1" />
          <SubmitButton label="End all House elections" />
        </form>
        <form action={bulkEndElections} className="inline">
          <input type="hidden" name="end_senate" value="1" />
          <SubmitButton label="End all Senate elections" />
        </form>
      </div>

      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
        Or choose combinations
      </p>
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
        <SubmitButton label="End selected races" />
      </form>
    </section>
  );
}
