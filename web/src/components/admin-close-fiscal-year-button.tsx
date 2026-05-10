"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { closeFiscalYear } from "@/app/actions/fiscal";

export function AdminCloseFiscalYearButton({
  canRun,
  fiscalYearLabel,
}: {
  canRun: boolean;
  fiscalYearLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-snug text-[var(--psc-muted)]">
        Runs the same fiscal close as the budget workspace: if an appropriations act is in place, the year rolls forward;
        otherwise the active year is closed with the economy frozen until a budget is submitted.
      </p>
      {msg ? <p className="rounded border border-[var(--psc-border)] bg-white/80 px-2 py-1.5 text-[11px]">{msg}</p> : null}
      <button
        type="button"
        disabled={pending || !canRun}
        className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
        onClick={() => {
          if (
            !window.confirm(
              `Close economy for ${fiscalYearLabel}? This runs fiscal year close (freeze if no budget, otherwise advance to the next year).`,
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
        {pending ? "Closing…" : "Close economy"}
      </button>
      {!canRun ? (
        <p className="text-[10px] text-amber-950">
          Requires President or full staff (<span className="font-mono">admin</span> /{" "}
          <span className="font-mono">staff_super</span>).
        </p>
      ) : null}
    </div>
  );
}
