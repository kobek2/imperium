"use client";

import { useState, useTransition } from "react";
import { openOccupiedSeatElectionFilings } from "@/app/actions/simulation";

export function OpenOccupiedSeatFilingsForm() {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-2 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <h3 className="text-sm font-semibold">Open filings (occupied seats only)</h3>
      <p className="text-xs text-[var(--psc-muted)]">
        Activates dormant House, Senate, and President races that already exist but have not started
        yet. Only jurisdictions with at least one player are opened; races that are already live are
        left alone. Each opened race gets filing → primary → general as three consecutive 24-hour
        windows from the moment you click.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMsg(null);
          startTransition(async () => {
            try {
              const r = await openOccupiedSeatElectionFilings();
              setMsg(`Opened ${r.opened} race(s); skipped ${r.skipped}.`);
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "Something went wrong.");
            }
          });
        }}
        className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? "Opening…" : "Open occupied seat filings"}
      </button>
      {msg ? <p className="text-xs text-[var(--psc-muted)]">{msg}</p> : null}
    </div>
  );
}
