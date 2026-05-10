"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adminStartAppropriationsCountdown } from "@/app/actions/fiscal";
import { AppropriationsCountdownBar } from "@/components/appropriations-countdown-bar";

export function EconomyAppropriationsWindowControls({
  fiscalYearLabel,
  fiscalYearIndex,
  appropriationDeadlineAt,
  appropriationsEnrolled,
  economyFrozen,
  canRun,
}: {
  fiscalYearLabel: string;
  fiscalYearIndex: number;
  appropriationDeadlineAt: string | null;
  appropriationsEnrolled: boolean;
  economyFrozen: boolean;
  canRun: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [hours, setHours] = useState(24);
  const [msg, setMsg] = useState<string | null>(null);
  const nextIndex = fiscalYearIndex + 1;

  return (
    <section className="space-y-4 rounded border border-sky-700/30 bg-sky-50 p-4 text-sm text-sky-950">
      <h2 className="text-base font-semibold text-sky-950">Appropriations window (staff)</h2>
      <p className="text-xs leading-relaxed">
        The simulation no longer auto-starts fiscal deadlines. In <strong>RP September</strong>, use this to start a{" "}
        <strong>real-time</strong> countdown so the President and Congress see time left to pass the annual appropriations
        act. Treasury and tax tooling respect the same <strong>manual economy freeze</strong> as everyone else when staff
        freeze the active year.
      </p>
      <p className="text-xs leading-relaxed">
        Operating year on the server: <strong>{fiscalYearLabel}</strong> (index {fiscalYearIndex}). The workbook and
        appropriations bill on this site still attach to that active row until you <strong>close the year</strong>; after
        closeout, the next index becomes <strong>FY {nextIndex}</strong> for collections and the following September cycle.
      </p>
      <AppropriationsCountdownBar
        deadlineAt={appropriationDeadlineAt}
        enrolled={appropriationsEnrolled}
        economyFrozen={economyFrozen}
        variant="slate"
      />
      {!canRun ? (
        <p className="text-xs">Requires admin or staff_super.</p>
      ) : appropriationsEnrolled ? (
        <p className="text-xs font-medium text-emerald-900">An appropriations act is already enrolled for this year.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold">
            Hours for this window
            <input
              type="number"
              min={1}
              max={168}
              className="ml-2 w-20 rounded border border-sky-800/40 bg-white px-2 py-1 font-mono text-sm"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            disabled={pending}
            className="rounded border border-sky-800 bg-sky-900 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
            onClick={() => {
              start(async () => {
                setMsg(null);
                const r = await adminStartAppropriationsCountdown(hours);
                setMsg(r.message);
                if (r.ok) router.refresh();
              });
            }}
          >
            {pending ? "Starting…" : "Start appropriations countdown"}
          </button>
        </div>
      )}
      {msg ? <p className="rounded border border-sky-900/20 bg-white px-3 py-2 text-xs">{msg}</p> : null}
    </section>
  );
}
