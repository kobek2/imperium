"use client";

import { useState, useTransition } from "react";
import { adminUpdateFiscalConfig } from "@/app/actions/fiscal";

export function EconomyFiscalConfig({
  canEdit,
  initial,
}: {
  canEdit: boolean;
  initial: {
    appropriationWindowHours: number;
    taxDueDaysAfterClose: number;
    taxPenaltyDailyRate: number;
    taxWarningLeadDays: number;
  };
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [state, setState] = useState(initial);

  return (
    <section className="space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Fiscal controls</h2>
      <p className="text-xs text-[var(--psc-muted)]">
        Configure appropriations clock and tax lifecycle timing for the active fiscal year.
      </p>
      {msg ? <p className="text-xs text-[var(--psc-ink)]">{msg}</p> : null}
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canEdit) return;
          start(async () => {
            const r = await adminUpdateFiscalConfig(state);
            setMsg(r.message);
          });
        }}
      >
        <label className="grid gap-1 text-xs font-semibold">
          Appropriation window (hours)
          <input
            type="number"
            min={1}
            max={336}
            disabled={!canEdit}
            value={state.appropriationWindowHours}
            onChange={(e) => setState((s) => ({ ...s, appropriationWindowHours: Number(e.target.value) }))}
            className="border px-2 py-1 font-mono"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          Tax due days after close
          <input
            type="number"
            min={1}
            max={60}
            disabled={!canEdit}
            value={state.taxDueDaysAfterClose}
            onChange={(e) => setState((s) => ({ ...s, taxDueDaysAfterClose: Number(e.target.value) }))}
            className="border px-2 py-1 font-mono"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          Daily penalty rate (decimal)
          <input
            type="number"
            step="0.001"
            min={0}
            max={1}
            disabled={!canEdit}
            value={state.taxPenaltyDailyRate}
            onChange={(e) => setState((s) => ({ ...s, taxPenaltyDailyRate: Number(e.target.value) }))}
            className="border px-2 py-1 font-mono"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          Warning lead days
          <input
            type="number"
            min={0}
            max={30}
            disabled={!canEdit}
            value={state.taxWarningLeadDays}
            onChange={(e) => setState((s) => ({ ...s, taxWarningLeadDays: Number(e.target.value) }))}
            className="border px-2 py-1 font-mono"
          />
        </label>
        <div className="sm:col-span-2 lg:col-span-4">
          <button
            type="submit"
            disabled={pending || !canEdit}
            className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save fiscal settings"}
          </button>
        </div>
      </form>
    </section>
  );
}
