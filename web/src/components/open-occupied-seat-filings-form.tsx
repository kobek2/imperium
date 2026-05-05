"use client";

import { useState, useTransition } from "react";
import { startAllCongressionalElectionFilings } from "@/app/actions/simulation";

export function StartAllCongressionalElectionsForm() {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-2 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <h3 className="text-sm font-semibold">Start all congressional elections</h3>
      <p className="text-xs text-[var(--psc-muted)]">
        First <strong>creates dormant House/Senate rows</strong> for any home district or residence state that has
        players but no active (non-closed) seat race yet, then opens <strong>every dormant</strong> House and Senate race
        where at least one profile lists that district or state — the usual flow for <strong>re-election cycles</strong>.
        Skips races that are already live. Does <strong>not</strong> open President (use the presidential race tools).
        Each opened race gets filing → primary → general as three consecutive 24-hour windows from the click, same as
        opening one race from its admin page.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMsg(null);
          startTransition(async () => {
            try {
              const r = await startAllCongressionalElectionFilings();
              setMsg(
                `Created ${r.created} dormant template(s); opened ${r.opened} race(s); skipped ${r.skipped}.`,
              );
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "Something went wrong.");
            }
          });
        }}
        className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? "Starting…" : "Start all congressional elections"}
      </button>
      {msg ? <p className="text-xs text-[var(--psc-muted)]">{msg}</p> : null}
    </div>
  );
}
