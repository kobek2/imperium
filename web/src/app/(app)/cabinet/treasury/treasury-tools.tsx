"use client";

import { useState, useTransition } from "react";

type Row = {
  id: string;
  user_id: string;
  label: string;
  assessed_tax: number;
  paid_amount: number;
  outstanding_amount: number;
  total_penalties: number;
  status: string;
  due_at: string;
};

export function TreasuryTools({
  summary,
  settings,
  rows,
  issueWarningsAction,
  applyPenaltiesAction,
}: {
  summary: Record<string, unknown>;
  settings: { label?: string; tax_penalty_daily_rate?: number; tax_due_days_after_close?: number; tax_warning_lead_days?: number } | null;
  rows: Row[];
  issueWarningsAction: (scope: "due_soon" | "delinquent" | "all") => Promise<{ ok: boolean; message: string }>;
  applyPenaltiesAction: () => Promise<{ ok: boolean; message: string }>;
}) {
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      setFlash(null);
      const r = await fn();
      setFlash(r.message);
      if (r.ok) window.location.reload();
    });
  }

  return (
    <div className="space-y-6">
      {flash ? <p className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-2 text-sm">{flash}</p> : null}
      <section className="grid gap-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 md:grid-cols-4">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">Assessed</p>
          <p className="font-mono text-lg">${Number(summary.assessed ?? 0).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">Collected</p>
          <p className="font-mono text-lg">${Number(summary.paid ?? 0).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">Outstanding</p>
          <p className="font-mono text-lg">${Number(summary.outstanding ?? 0).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">Delinquent</p>
          <p className="font-mono text-lg">{Number(summary.delinquent_count ?? 0).toLocaleString()}</p>
        </div>
      </section>

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
        <h2 className="text-lg font-semibold">Actions</h2>
        <p className="mt-1 text-xs text-[var(--psc-muted)]">
          {settings?.label ?? "Active FY"} · due days {Number(settings?.tax_due_days_after_close ?? 0)} · warning lead{" "}
          {Number(settings?.tax_warning_lead_days ?? 0)} · daily penalty {(Number(settings?.tax_penalty_daily_rate ?? 0) * 100).toFixed(2)}%
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            className="rounded border px-3 py-2 text-sm font-semibold"
            onClick={() => run(() => issueWarningsAction("due_soon"))}
          >
            Issue due-soon warnings
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded border px-3 py-2 text-sm font-semibold"
            onClick={() => run(() => issueWarningsAction("delinquent"))}
          >
            Issue delinquent warnings
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded border px-3 py-2 text-sm font-semibold"
            onClick={() => run(applyPenaltiesAction)}
          >
            Apply daily penalties
          </button>
        </div>
      </section>

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
        <h2 className="text-lg font-semibold">Tax accounts</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--psc-border)]">
                <th className="py-2 pr-2">Player</th>
                <th className="py-2 pr-2">Assessed</th>
                <th className="py-2 pr-2">Paid</th>
                <th className="py-2 pr-2">Outstanding</th>
                <th className="py-2 pr-2">Penalties</th>
                <th className="py-2 pr-2">Due</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--psc-border)]/60">
                  <td className="py-1.5 pr-2 text-[var(--psc-ink)]">{r.label}</td>
                  <td className="py-1.5 pr-2 font-mono">${Number(r.assessed_tax).toLocaleString()}</td>
                  <td className="py-1.5 pr-2 font-mono">${Number(r.paid_amount).toLocaleString()}</td>
                  <td className="py-1.5 pr-2 font-mono">${Number(r.outstanding_amount).toLocaleString()}</td>
                  <td className="py-1.5 pr-2 font-mono">${Number(r.total_penalties).toLocaleString()}</td>
                  <td className="py-1.5 pr-2">{new Date(r.due_at).toLocaleString()}</td>
                  <td className="py-1.5">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
