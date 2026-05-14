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
      <h2 className="text-base font-semibold text-sky-950">Budget transition window (staff)</h2>
      <p className="text-xs leading-relaxed">
        Start a <strong>real-time</strong> countdown on the active fiscal year. While it runs, Treasury still collects for the
        active tax year, and a <strong>next-year draft workbook</strong> opens on Economy → Federal for the President. When
        Congress passes the federal appropriations measure and the President <strong>signs it into law</strong> from the Oval
        Office, the server rolls the fiscal year (tax settlement, debt metrics, new active year). Staff use the{" "}
        <strong>economy freeze</strong> toggle if the window expires without a signing; unfreezing does not pay out hours that
        passed while frozen.
      </p>
      <p className="text-xs leading-relaxed">
        Operating year on the server: <strong>{fiscalYearLabel}</strong> (index {fiscalYearIndex}). After the enrolled act is
        signed, that year closes and index <strong>FY {nextIndex}</strong> becomes active for collections.
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
            {pending ? "Starting…" : "Start budget transition"}
          </button>
        </div>
      )}
      {msg ? <p className="rounded border border-sky-900/20 bg-white px-3 py-2 text-xs">{msg}</p> : null}
    </section>
  );
}
