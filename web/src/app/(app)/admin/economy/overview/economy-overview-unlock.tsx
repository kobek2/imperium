"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { submitFiscalBudget } from "@/app/actions/fiscal";

export function EconomyOverviewUnlock({
  fiscalYearId,
  fiscalYearLabel,
  budgetStatus,
  canMarkSubmitted,
  isTransitionSubmit = false,
}: {
  fiscalYearId: string | null;
  fiscalYearLabel: string;
  budgetStatus: string | null;
  canMarkSubmitted: boolean;
  /** When true, submitting rolls the year (pending_activation workbook). */
  isTransitionSubmit?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  if (!fiscalYearId) {
    return (
      <p className="text-sm text-[var(--psc-muted)]">No active fiscal year — nothing to unlock.</p>
    );
  }

  if (budgetStatus === "submitted" && !isTransitionSubmit) {
    return (
      <div className="rounded border border-emerald-800/40 bg-emerald-50 p-4 text-sm text-emerald-950">
        <p className="font-semibold">Economy unlocked</p>
        <p className="mt-1">
          Active year <span className="font-mono">{fiscalYearLabel}</span> already has a submitted federal budget.
        </p>
      </div>
    );
  }

  if (budgetStatus === "submitted" && isTransitionSubmit) {
    return (
      <div className="rounded border border-amber-800/40 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">Unexpected state</p>
        <p className="mt-1">
          Transition workbook for <span className="font-mono">{fiscalYearLabel}</span> is already marked submitted. Refresh
          or ask engineering if the year did not roll.
        </p>
      </div>
    );
  }

  if (!canMarkSubmitted) {
    return (
      <div className="rounded border border-amber-800/40 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">Requires full staff</p>
        <p className="mt-1">
          Only operators with the <span className="font-mono">admin</span> or <span className="font-mono">staff_super</span>{" "}
          grant can {isTransitionSubmit ? "submit the transition workbook and roll the year" : "mark the budget submitted"}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <p className="text-sm font-semibold text-[var(--psc-ink)]">
        {isTransitionSubmit ? "Roll fiscal year (staff submit transition workbook)" : "Unlock economy (mark budget submitted)"}
      </p>
      <p className="text-xs text-[var(--psc-muted)]">
        {isTransitionSubmit
          ? "Runs the same database roll as a presidential signing when the enrolled appropriations act becomes law. Use only if the Oval path cannot be used."
          : "Use when the appropriations act has been adopted and line items are at least at minimum. This runs the same database action as the presidential submit control."}
      </p>
      {msg ? <p className="text-xs text-[var(--psc-ink)]">{msg}</p> : null}
      <button
        type="button"
        disabled={pending}
        className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        onClick={() => {
          if (
            !window.confirm(
              isTransitionSubmit
              ? `Submit the transition federal budget for ${fiscalYearLabel} and roll the fiscal year? This settles tax on the current active year and activates the next year.`
              : `Mark the federal budget for ${fiscalYearLabel} as submitted and unlock economy actions for all players?`,
            )
          ) {
            return;
          }
          start(async () => {
            setMsg(null);
            const r = await submitFiscalBudget(fiscalYearId);
            setMsg(r.message);
            if (r.ok) router.refresh();
          });
        }}
      >
        {pending ? "Working…" : isTransitionSubmit ? "Submit transition & roll year" : "Mark budget submitted & unlock"}
      </button>
    </div>
  );
}
