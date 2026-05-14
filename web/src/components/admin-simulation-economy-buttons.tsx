"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adminStartAppropriationsCountdown, closeFiscalYear } from "@/app/actions/fiscal";
import { adminUnfreezeEconomy } from "@/app/actions/simulation";

const btn =
  "rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

export function AdminSimulationEconomyButtons({
  canCloseFiscalYear,
  canStartAppropriationsClock,
  fiscalYearLabel,
}: {
  canCloseFiscalYear: boolean;
  canStartAppropriationsClock: boolean;
  fiscalYearLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {msg ? (
        <p className="rounded border border-[var(--psc-border)] bg-white/80 px-2 py-1.5 text-[11px] text-[var(--psc-ink)]">
          {msg}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !canStartAppropriationsClock}
          className={btn}
          onClick={() => {
            start(async () => {
              setMsg(null);
              const r = await adminStartAppropriationsCountdown(24);
              setMsg(r.message);
              if (r.ok) router.refresh();
            });
          }}
        >
          {pending ? "Working…" : "Start 24-hour transition"}
        </button>
        <button
          type="button"
          disabled={pending || !canCloseFiscalYear}
          className={btn}
          onClick={() => {
            if (
              !window.confirm(
                `Close fiscal year (${fiscalYearLabel})? This runs year-end closeout: requires a submitted federal budget, withholds income tax from wallets, and opens the next FY. It is not the manual economy freeze. Continue?`,
              )
            )
              return;
            start(async () => {
              setMsg(null);
              const r = await closeFiscalYear();
              setMsg(r.message);
              if (r.ok) router.refresh();
            });
          }}
        >
          {pending ? "Working…" : "Close fiscal year"}
        </button>
        <button
          type="button"
          disabled={pending}
          className="rounded border border-rose-900 bg-rose-950 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            if (!window.confirm("Unfreeze the economy?")) return;
            start(async () => {
              setMsg(null);
              try {
                await adminUnfreezeEconomy();
                router.refresh();
              } catch (e) {
                setMsg(e instanceof Error ? e.message : String(e));
              }
            });
          }}
        >
          {pending ? "Working…" : "Unfreeze economy"}
        </button>
      </div>
      {!canStartAppropriationsClock ? (
        <p className="text-[10px] text-amber-950">24-hour transition requires full staff (admin / staff_super).</p>
      ) : null}
      {!canCloseFiscalYear ? (
        <p className="text-[10px] text-amber-950">
          Close economy requires President or full staff (admin / staff_super).
        </p>
      ) : null}
    </div>
  );
}
