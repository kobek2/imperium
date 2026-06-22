"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  adminEconomyFullResetKeepWallets,
  adminCancelBudgetTransition,
  adminResetEconomyFy4FromEnactedBill,
  adminApplyFy4BudgetTaxBaseline,
  adminSimulationTransitionToFy4StaffBaseline,
  adminTaxForgiveOutstandingAndBalanceBooks,
  closeFiscalYear,
} from "@/app/actions/fiscal";
import { DEFAULT_ENACTED_FY4_APPROPRIATIONS_BILL_ID } from "@/lib/fiscal-admin-constants";

export function EconomyFiscalAdminControls({
  fiscalYearLabel,
  fiscalYearIndex,
  canRun,
  transitionPending = false,
}: {
  fiscalYearLabel: string;
  /** Used to show the scripted FY4 transition only when active year is FY 3. */
  fiscalYearIndex: number;
  canRun: boolean;
  /** When true, legacy close is blocked until staff cancel the transition draft or the President rolls the year. */
  transitionPending?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [fy4BillId, setFy4BillId] = useState("");

  return (
    <section className="space-y-4 rounded border border-amber-800/40 bg-amber-50 p-4 text-sm text-amber-950">
      <h2 className="text-base font-semibold text-amber-950">Fiscal moderation controls</h2>
      <p className="text-xs leading-relaxed">
        Moderator-only fiscal controls moved out of the President budget workspace. Prefer the{" "}
        <strong>budget transition</strong> flow (24h window + submit next-year workbook) over legacy close when possible.
      </p>
      {!canRun ? (
        <p className="text-xs">
          Requires <span className="font-mono">admin</span> or <span className="font-mono">staff_super</span>.
        </p>
      ) : null}
      {msg ? <p className="rounded border border-amber-900/30 bg-white px-3 py-2 text-xs">{msg}</p> : null}
      <div className="rounded border border-indigo-900/30 bg-white/90 p-3 text-xs text-amber-950">
        <p className="font-semibold text-indigo-950">FY4 clean slate (enacted appropriations law)</p>
        <p className="mt-1 leading-relaxed text-[var(--psc-muted)]">
          Clears economy ledgers, PACs, disclosed contributions, corruption records, businesses, stock holdings/trades,
          campaign ads, ads inventory, blackjack, party treasuries, and federal treasury cash; deletes all fiscal years and
          opens one FY4 with the brackets and $284,067,634 appropriations table from the enrolled FY4 act. Player wallet
          balances are kept. The bill must already be <span className="font-mono">law</span> and flagged as federal
          appropriations. Leave blank to use the default bill id.
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[min(100%,280px)] flex-1 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
              Enacted appropriations bill id (optional)
            </span>
            <input
              value={fy4BillId}
              onChange={(e) => setFy4BillId(e.target.value)}
              placeholder={DEFAULT_ENACTED_FY4_APPROPRIATIONS_BILL_ID}
              spellCheck={false}
              className="w-full border border-[var(--psc-border)] px-2 py-1.5 font-mono text-[11px] text-[var(--psc-ink)]"
            />
          </label>
          <button
            type="button"
            disabled={pending || !canRun}
            className="rounded border border-indigo-900 bg-indigo-900 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
            onClick={() => {
              if (
                !window.confirm(
                  "This wipes economy transaction history and all fiscal years, then opens FY4 from the enacted appropriations bill. Wallet balances are kept. Continue?",
                )
              ) {
                return;
              }
              start(async () => {
                setMsg(null);
                const fd = new FormData();
                const t = fy4BillId.trim();
                if (t) fd.set("bill_id", t);
                const r = await adminResetEconomyFy4FromEnactedBill(fd);
                setMsg(r.message);
                if (r.ok) router.refresh();
              });
            }}
          >
            {pending ? "Applying…" : "Reset economy → FY4 (enacted bill)"}
          </button>
        </div>
      </div>
      {fiscalYearIndex === 4 ? (
        <div className="rounded border border-sky-900/30 bg-sky-50/90 p-3 text-xs text-sky-950">
          <p className="font-semibold text-sky-950">FY4 budget on disk (treasury + tax rows only)</p>
          <p className="mt-1 leading-relaxed text-[var(--psc-muted)]">
            Writes the enacted FY4 brackets and $284,067,634 appropriations table to the active federal budget, sets federal
            treasury cash to $0 and removes FY4 cash deployment rows, clears FY4 tax event history, then recomputes each
            player&apos;s assessed tax as <strong>72 × marginal tax on one scheduled hour</strong> of role + PAC pay
            (same formula as the federal bracket impact table totals), with <strong>paid = $0</strong> and outstanding =
            assessed. Not wallet balances, not cumulative <span className="font-mono">hourly_income</span> ledger totals, and
            not <code>marginal_tax(hourly×72)</code> (that overstates vs the workbook). Does not truncate the economy ledger
            or change wallet balances.
          </p>
          <button
            type="button"
            disabled={pending || !canRun}
            className="mt-2 rounded border border-sky-900 bg-sky-900 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
            onClick={() => {
              if (
                !window.confirm(
                  "Apply FY4 tax baseline? Federal treasury goes to $0, FY4 deployment history is cleared, and every player's tax paid is reset to $0 with new assessments from scheduled hourly pay × 72 (RP-year model, same as federal bracket preview).",
                )
              ) {
                return;
              }
              start(async () => {
                setMsg(null);
                const r = await adminApplyFy4BudgetTaxBaseline();
                setMsg(r.message);
                if (r.ok) router.refresh();
              });
            }}
          >
            {pending ? "Applying…" : "Apply FY4 budget (zero treasury & tax paid, re-assess)"}
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !canRun || transitionPending}
          className="rounded border border-rose-800 bg-rose-900 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
          onClick={() => {
            if (
              !window.confirm(
                `Close ${fiscalYearLabel} (legacy)? This settles tax/spending, closes the year, and inserts a fresh active year + draft. Blocked while a transition draft is open — cancel the transition first, or submit that workbook.`,
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
          {pending ? "Closing…" : "Close fiscal year (legacy)"}
        </button>
        <button
          type="button"
          disabled={pending || !canRun || !transitionPending}
          className="rounded border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
          onClick={() => {
            if (!window.confirm("Cancel the open transition draft and clear the 24h countdown on the active year?")) return;
            start(async () => {
              setMsg(null);
              const r = await adminCancelBudgetTransition();
              setMsg(r.message);
              if (r.ok) router.refresh();
            });
          }}
        >
          {pending ? "Working…" : "Cancel budget transition"}
        </button>
        <button
          type="button"
          disabled={pending || !canRun}
          className="rounded border border-emerald-900 bg-emerald-900 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
          onClick={() => {
            if (
              !window.confirm(
                "Forgive ALL outstanding income tax for every player (no wallet debits), credit federal treasury by that amount, and mark past fiscal closes as if tax fully funded appropriations? Federal budget line minima are unchanged.",
              )
            ) {
              return;
            }
            start(async () => {
              setMsg(null);
              const r = await adminTaxForgiveOutstandingAndBalanceBooks();
              setMsg(r.message);
              if (r.ok) router.refresh();
            });
          }}
        >
          {pending ? "Applying…" : "Forgive tax & balance books"}
        </button>
        {fiscalYearIndex === 3 ? (
          <button
            type="button"
            disabled={pending || !canRun}
            className="rounded border border-indigo-900 bg-indigo-900 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
            onClick={() => {
              if (
                !window.confirm(
                  `DESTRUCTIVE: Close ${fiscalYearLabel}, delete any existing FY 4 row, open FY 4 with a 24h appropriations window, seed agreed line minima, set debt to −$290,124,491, GDP growth baseline $230,120,124, and distribute $45M tax paid across profiles. Requires active FY 3. Continue?`,
                )
              ) {
                return;
              }
              start(async () => {
                setMsg(null);
                const r = await adminSimulationTransitionToFy4StaffBaseline();
                setMsg(r.message);
                if (r.ok) router.refresh();
              });
            }}
          >
            {pending ? "Applying…" : "Sim: transition to FY 4"}
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending || !canRun}
          className="rounded border border-amber-950 bg-amber-950 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-amber-50 disabled:opacity-50"
          onClick={() => {
            if (
              !window.confirm(
                "Reset economy and fiscal simulation to FY1 while keeping personal wallet balances? This also wipes PACs, businesses, stock market activity, and campaign ad spend history.",
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
