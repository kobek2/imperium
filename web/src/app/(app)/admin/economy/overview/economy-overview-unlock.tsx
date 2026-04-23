"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { submitFiscalBudget } from "@/app/actions/fiscal";

export function EconomyOverviewUnlock({
  fiscalYearId,
  fiscalYearLabel,
  budgetStatus,
  canMarkSubmitted,
}: {
  fiscalYearId: string | null;
  fiscalYearLabel: string;
  budgetStatus: string | null;
  canMarkSubmitted: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  if (!fiscalYearId) {
    return (
      <p className="text-sm text-[var(--psc-muted)]">No active fiscal year — nothing to unlock.</p>
    );
  }

  if (budgetStatus === "submitted") {
    return (
      <div className="rounded border border-emerald-800/40 bg-emerald-50 p-4 text-sm text-emerald-950">
        <p className="font-semibold">Economy unlocked</p>
        <p className="mt-1">
          Active year <span className="font-mono">{fiscalYearLabel}</span> already has a submitted federal budget.
        </p>
      </div>
    );
  }

  if (!canMarkSubmitted) {
    return (
      <div className="rounded border border-amber-800/40 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">Unlock requires full staff</p>
        <p className="mt-1">
          Only operators with the <span className="font-mono">admin</span> or <span className="font-mono">staff_super</span>{" "}
          grant can mark the budget submitted after Congress adopts the appropriations act.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <p className="text-sm font-semibold text-[var(--psc-ink)]">Unlock economy (mark budget submitted)</p>
      <p className="text-xs text-[var(--psc-muted)]">
        Use when the appropriations act has been adopted and line items are at least at minimum. This runs the same database
        action as the former presidential submit control.
      </p>
      {msg ? <p className="text-xs text-[var(--psc-ink)]">{msg}</p> : null}
      <button
        type="button"
        disabled={pending}
        className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        onClick={() => {
          if (
            !window.confirm(
              `Mark the federal budget for ${fiscalYearLabel} as submitted and unlock economy actions for all players?`,
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
        {pending ? "Working…" : "Mark budget submitted & unlock"}
      </button>
    </div>
  );
}
