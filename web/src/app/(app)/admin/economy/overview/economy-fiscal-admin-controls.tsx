"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adminEconomyFullResetKeepWallets, closeFiscalYear } from "@/app/actions/fiscal";

export function EconomyFiscalAdminControls({
  fiscalYearLabel,
  canRun,
}: {
  fiscalYearLabel: string;
  canRun: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <section className="space-y-4 rounded border border-amber-800/40 bg-amber-50 p-4 text-sm text-amber-950">
      <h2 className="text-base font-semibold text-amber-950">Fiscal moderation controls</h2>
      <p className="text-xs leading-relaxed">
        Moderator-only fiscal controls moved out of the President budget workspace. Use these when staff need to run
        year rollover or a simulation reset.
      </p>
      {!canRun ? (
        <p className="text-xs">
          Requires <span className="font-mono">admin</span> or <span className="font-mono">staff_super</span>.
        </p>
      ) : null}
      {msg ? <p className="rounded border border-amber-900/30 bg-white px-3 py-2 text-xs">{msg}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !canRun}
          className="rounded border border-rose-800 bg-rose-900 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
          onClick={() => {
            if (
              !window.confirm(
                `Close ${fiscalYearLabel}? This settles tax/spending, closes the year, and opens the next fiscal year.`,
              )
            ) {
              return;
            }
            start(async () => {
              setMsg(null);
              const r = await closeFiscalYear();
              setMsg(r.message);
              if (r.ok) router.refresh();
            });
          }}
        >
          {pending ? "Closing…" : "Close fiscal year"}
        </button>
        <button
          type="button"
          disabled={pending || !canRun}
          className="rounded border border-amber-950 bg-amber-950 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-amber-50 disabled:opacity-50"
          onClick={() => {
            if (
              !window.confirm(
                "Reset economy and fiscal simulation to FY1 while keeping personal wallet balances?",
              )
            ) {
              return;
            }
            start(async () => {
              setMsg(null);
              const r = await adminEconomyFullResetKeepWallets();
              setMsg(r.message);
              if (r.ok) router.refresh();
            });
          }}
        >
          {pending ? "Resetting…" : "Reset economy (keep wallets)"}
        </button>
      </div>
    </section>
  );
}
