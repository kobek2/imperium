"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { treasuryDeployFederalCash, treasuryDeployFederalCashSplitLines } from "@/app/actions/fiscal";

export type TreasuryOutlayRow = {
  category: string;
  line_item_key: string | null;
  amount: number;
  note: string | null;
  created_at: string;
};

function fmtUsd(n: number): string {
  return `$${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function TreasuryCashDeployment({
  lineOptions,
  usDebt,
  treasuryBalance,
  recentOutlays,
  lineSpendTotals,
  debtSpendTotal,
  canDeploy,
}: {
  lineOptions: { key: string; label: string }[];
  usDebt: number | null;
  treasuryBalance: number;
  recentOutlays: TreasuryOutlayRow[];
  lineSpendTotals: Record<string, number>;
  debtSpendTotal: number;
  canDeploy: boolean;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<"us_debt" | "budget_line">("us_debt");
  const [lineKey, setLineKey] = useState<string>(lineOptions[0]?.key ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [splitMode, setSplitMode] = useState<"equal" | "proportional">("equal");
  const [splitCap, setSplitCap] = useState("");
  const [splitNote, setSplitNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const lineLabelByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of lineOptions) m.set(row.key, row.label);
    return m;
  }, [lineOptions]);

  const debt = Number(usDebt ?? 0);
  const debtDeployHint =
    debt > 0
      ? `Positive means net debt on the sim ledger. Deployments reduce it toward zero, capped at ${fmtUsd(debt)}, treasury cash, and your amount.`
      : debt < 0
        ? `Negative means a net surplus on the sim ledger. Deployments move this toward zero, capped at ${fmtUsd(Math.abs(debt))}, treasury cash, and your amount.`
        : "Debt metric is exactly zero — use budget line buckets or set a baseline in national metrics if you need a position to deploy against.";

  function submit() {
    setMsg(null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setMsg({ ok: false, text: "Enter a valid positive amount." });
      return;
    }
    start(async () => {
      const r = await treasuryDeployFederalCash({
        category,
        lineItemKey: category === "budget_line" ? lineKey : undefined,
        amount: n,
        note: note.trim() || undefined,
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setAmount("");
        setNote("");
        router.refresh();
      }
    });
  }

  function submitSplit() {
    setMsg(null);
    const capTrim = splitCap.trim();
    const capNum = capTrim === "" ? undefined : Number(capTrim);
    if (capTrim !== "" && (!Number.isFinite(capNum) || (capNum ?? 0) <= 0)) {
      setMsg({ ok: false, text: "Cap must be empty (use full treasury) or a valid positive amount." });
      return;
    }
    start(async () => {
      const r = await treasuryDeployFederalCashSplitLines({
        mode: splitMode,
        capAmount: capNum,
        note: splitNote.trim() || undefined,
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setSplitCap("");
        setSplitNote("");
        router.refresh();
      }
    });
  }

  return (
    <section
      className="mt-6 rounded border border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-accent)_6%,transparent)] p-5"
      aria-labelledby="treasury-deploy-heading"
    >
      <h3 id="treasury-deploy-heading" className="text-sm font-semibold text-[var(--psc-ink)]">
        Deploy treasury cash
      </h3>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--psc-muted)]">
        Move funds out of the federal treasury cash balance toward simulated U.S. debt or toward a budget line bucket (for
        visibility in sim reporting). Appropriations law sets budget floors and line amounts in the budget JSON; that total
        is not auto-debited from treasury. Tax receipts increase treasury cash first; manual deploy (single line or split
        below) records where cash is allocated for reporting.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border border-[var(--psc-border)]/80 bg-[var(--psc-panel)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">U.S. debt (sim, signed)</p>
          <p className="mt-1 font-mono text-lg text-[var(--psc-ink)]">{fmtUsd(debt)}</p>
          <p className="mt-1 text-[11px] text-[var(--psc-muted)]">Paid down cumulatively: {fmtUsd(debtSpendTotal)}</p>
        </div>
        <div className="rounded border border-[var(--psc-border)]/80 bg-[var(--psc-panel)] p-3 sm:col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Line buckets (deployed)</p>
          {lineOptions.length ? (
            <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-[11px] text-[var(--psc-ink)]">
              {lineOptions.map((row) => (
                <li key={row.key} className="flex justify-between gap-2 font-mono">
                  <span className="truncate">{row.label}</span>
                  <span>{fmtUsd(lineSpendTotals[row.key] ?? 0)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-[var(--psc-muted)]">No line items on the active budget row yet.</p>
          )}
        </div>
        <div className="rounded border border-[var(--psc-border)]/80 bg-[var(--psc-panel)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Treasury cash</p>
          <p className="mt-1 font-mono text-lg text-[var(--psc-ink)]">{fmtUsd(treasuryBalance)}</p>
        </div>
      </div>

      {canDeploy ? (
        <div className="mt-5 space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-[var(--psc-ink)]">
              Target
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as "us_debt" | "budget_line")}
                className="border border-[var(--psc-border)] bg-white px-2 py-2 font-normal"
              >
                <option value="us_debt">Pay down U.S. debt</option>
                <option value="budget_line">Budget line bucket</option>
              </select>
            </label>
            {category === "budget_line" ? (
              <label className="grid gap-1 text-xs font-semibold text-[var(--psc-ink)]">
                Line item
                <select
                  value={lineKey}
                  onChange={(e) => setLineKey(e.target.value)}
                  className="border border-[var(--psc-border)] bg-white px-2 py-2 font-normal"
                >
                  {lineOptions.map((row) => (
                    <option key={row.key} value={row.key}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="self-end text-xs text-[var(--psc-muted)]">{debtDeployHint}</p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-[var(--psc-ink)]">
              Amount ($)
              <input
                type="number"
                min={1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="border border-[var(--psc-border)] px-2 py-2 font-mono"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-[var(--psc-ink)]">
              Note (optional)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Q1 debt buyback"
                className="border border-[var(--psc-border)] px-2 py-2"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={pending || (category === "budget_line" && !lineKey)}
            onClick={submit}
            className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase text-white disabled:opacity-60"
          >
            {pending ? "Deploying…" : "Deploy cash"}
          </button>
          {msg ? (
            <p className={`text-xs ${msg.ok ? "text-emerald-800" : "text-rose-800"}`} role="status">
              {msg.text}
            </p>
          ) : null}

          <div className="border-t border-[var(--psc-border)]/80 pt-4">
            <p className="text-xs font-semibold text-[var(--psc-ink)]">Split across all line buckets</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--psc-muted)]">
              Equal: divide the pool evenly across every line on the active budget. Proportional: divide by each
              line&apos;s enacted allocation (falls back to equal if all allocations are zero). One treasury debit; one
              outlay row per line with a positive share.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-xs font-semibold text-[var(--psc-ink)]">
                Split mode
                <select
                  value={splitMode}
                  onChange={(e) => setSplitMode(e.target.value as "equal" | "proportional")}
                  className="border border-[var(--psc-border)] bg-white px-2 py-2 font-normal"
                >
                  <option value="equal">Equal per line</option>
                  <option value="proportional">Match allocation shares</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-[var(--psc-ink)]">
                Cap ($, optional)
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={splitCap}
                  onChange={(e) => setSplitCap(e.target.value)}
                  placeholder="Blank = all treasury cash"
                  className="border border-[var(--psc-border)] px-2 py-2 font-mono"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-[var(--psc-ink)]">
                Note (optional)
                <input
                  value={splitNote}
                  onChange={(e) => setSplitNote(e.target.value)}
                  placeholder="e.g. Q1 across buckets"
                  className="border border-[var(--psc-border)] px-2 py-2"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={pending || !lineOptions.length}
              onClick={submitSplit}
              className="mt-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-2 text-xs font-semibold uppercase text-[var(--psc-ink)] hover:bg-[color-mix(in_srgb,var(--psc-accent)_12%,transparent)] disabled:opacity-60"
            >
              {pending ? "Deploying…" : "Deploy split to all lines"}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs text-[var(--psc-muted)]">
          Only the President, Secretary of the Treasury, or full staff operators may deploy cash from this station.
        </p>
      )}

      {recentOutlays.length ? (
        <div className="mt-5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Recent deployments</p>
          <ul className="mt-2 space-y-1 text-[11px] text-[var(--psc-muted)]">
            {recentOutlays.map((o) => {
              const lineLbl =
                o.category === "budget_line"
                  ? (lineLabelByKey.get(String(o.line_item_key ?? "")) ?? o.line_item_key ?? "—")
                  : null;
              return (
                <li key={`${o.created_at}-${o.amount}-${o.category}-${o.line_item_key ?? ""}`} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {new Date(o.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })} ·{" "}
                    {o.category === "us_debt" ? "Debt paydown" : `Line: ${lineLbl}`}
                  </span>
                  <span className="font-mono text-[var(--psc-ink)]">{fmtUsd(o.amount)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
