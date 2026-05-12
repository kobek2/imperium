"use client";

import { useCallback, useEffect, useState } from "react";
import type { FederalBudgetPriorYearTutorialContext } from "@/lib/federal-budget-tutorial-types";
import type { FiscalTaxBracketRow } from "@/lib/fiscal-budget-types";

const STORAGE_DONE = "federal_budget_interactive_tutorial_done";

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function scrollToId(id: string) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function FederalBudgetInteractiveTutorial({
  show,
  /** When true (e.g. `?walkthrough=budget`), ignore the browser “done” flag so staff can re-open the tour. */
  walkthroughForced = false,
  yearLabel,
  fiscalYearIndex,
  priorYear,
  walletTotal,
  gdpOpeningTotal,
  taxPaidYtd,
  playersTaxPaidActiveFy,
  estimatedTaxYtd,
  totalAllocated,
  draftNetTaxVsAppropriations,
  treasuryBalance,
  brackets,
}: {
  show: boolean;
  walkthroughForced?: boolean;
  yearLabel: string;
  /** Active fiscal year index (`rp_fiscal_years.year_index`). Step 4 budget copy uses FY (index + 1). */
  fiscalYearIndex: number;
  priorYear: FederalBudgetPriorYearTutorialContext | null;
  walletTotal: number;
  gdpOpeningTotal: number | null;
  /** Sum of fiscal_tax_accounts.paid_amount for the active FY. */
  taxPaidYtd: number;
  playersTaxPaidActiveFy: number;
  estimatedTaxYtd: number;
  totalAllocated: number;
  draftNetTaxVsAppropriations: number;
  treasuryBalance: number;
  brackets: FiscalTaxBracketRow[];
}) {
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || walkthroughForced) return;
    setDismissed(window.localStorage.getItem(STORAGE_DONE) === "1");
  }, [walkthroughForced]);

  const finish = useCallback(() => {
    if (typeof window !== "undefined" && !walkthroughForced) window.localStorage.setItem(STORAGE_DONE, "1");
    setDismissed(true);
  }, [walkthroughForced]);

  if (!show || (dismissed && !walkthroughForced)) return null;

  const budgetTargetYearLabel = `FY ${fiscalYearIndex + 1}`;

  /** Cash receipts vs this draft's appropriations (same basis as Budget status “Total remaining”). */
  const cashShortfallVsAppropriations = Math.max(0, totalAllocated - taxPaidYtd);
  const cashSurplusVsAppropriations = Math.max(0, taxPaidYtd - totalAllocated);
  /** Positive = this FY cash surplus vs draft; negative = cash deficit; zero = balanced. */
  const thisYearCashNetVsDraft = taxPaidYtd - totalAllocated;

  const steps = [
    {
      title: "Step 1 — Read last year’s results",
      body: priorYear ? (
        <div className="space-y-2 text-sm leading-relaxed text-sky-950">
          <p>
            In <strong>{priorYear.yearLabel}</strong>, the government spent {money(priorYear.totalAppropriations)}.
          </p>
          <p>
            During that year, the Treasury department collected {money(priorYear.taxCollectedTotal)} across{" "}
            <strong>{priorYear.playersWithTaxPaid}</strong> {priorYear.playersWithTaxPaid === 1 ? "player" : "players"}.
          </p>
          <p>
            This resulted in a{" "}
            <strong className={priorYear.impliedNet >= 0 ? "text-emerald-900" : "text-rose-900"}>
              {priorYear.impliedNet >= 0 ? "surplus" : "deficit"}
            </strong>{" "}
            of{" "}
            <strong className={priorYear.impliedNet >= 0 ? "text-emerald-900" : "text-rose-900"}>
              {money(Math.abs(priorYear.impliedNet))}
            </strong>
            .
          </p>
          <p>
            {priorYear.gdpOpening != null && priorYear.gdpClosing != null ? (
              <>
                The economy changed from {money(priorYear.gdpOpening)} to {money(priorYear.gdpClosing)}, resulting in a{" "}
                <strong>
                  {priorYear.gdpClosing - priorYear.gdpOpening >= 0 ? "gain" : "decline"} of{" "}
                  {money(Math.abs(priorYear.gdpClosing - priorYear.gdpOpening))}
                </strong>{" "}
                in GDP growth.
              </>
            ) : (
              <>GDP opening and closing snapshots for that year are not both on file.</>
            )}
          </p>
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-sky-950">
          There is no closed fiscal year on file yet, so there are no prior appropriations/tax outcomes to compare. Use the
          live GDP and treasury tiles on this page as your anchor; once the first year closes, this step will populate
          automatically.
        </p>
      ),
    },
    {
      title: "Step 2 — Economy pulse (this active year)",
      body: (
        <div className="space-y-2 text-sm leading-relaxed text-sky-950">
          <p>
            This year, the government plans to spend <strong>{money(totalAllocated)}</strong>.
          </p>
          <p>
            So far, the government has collected <strong>{money(taxPaidYtd)}</strong> across{" "}
            <strong>{playersTaxPaidActiveFy}</strong> {playersTaxPaidActiveFy === 1 ? "player" : "players"}.
          </p>
          <p>
            {cashShortfallVsAppropriations > 0 ? (
              <>
                The Secretary of the Treasury still needs to collect:{" "}
                <strong className="text-rose-900">{money(cashShortfallVsAppropriations)}</strong>.
              </>
            ) : cashSurplusVsAppropriations > 0 ? (
              <>
                The Secretary of the Treasury has no remaining collection gap against this draft; receipts exceed
                appropriations by <strong className="text-emerald-900">{money(cashSurplusVsAppropriations)}</strong>.
              </>
            ) : (
              <>
                The Secretary of the Treasury has no remaining collection gap against this draft; receipts match planned
                spend in cash.
              </>
            )}
          </p>
          <p>
            {treasuryBalance < 0 ? (
              <>
                The current federal deficit is <strong>{money(-treasuryBalance)}</strong>, including this year&apos;s{" "}
                {thisYearCashNetVsDraft === 0 ? (
                  <>
                    <strong>balanced</strong> position vs. this draft.
                  </>
                ) : thisYearCashNetVsDraft < 0 ? (
                  <>
                    <strong className="text-rose-900">deficit</strong> of{" "}
                    <strong className="text-rose-900">{money(-thisYearCashNetVsDraft)}</strong>.
                  </>
                ) : (
                  <>
                    <strong className="text-emerald-900">surplus</strong> of{" "}
                    <strong className="text-emerald-900">{money(thisYearCashNetVsDraft)}</strong>.
                  </>
                )}
              </>
            ) : (
              <>There is no cumulative federal shortage on the books right now.</>
            )}
          </p>
          <p>
            {gdpOpeningTotal != null ? (
              <>
                The economy changed from {money(gdpOpeningTotal)} to {money(walletTotal)}, resulting in a{" "}
                <strong>
                  {walletTotal - gdpOpeningTotal >= 0 ? "gain" : "decline"} of{" "}
                  {money(Math.abs(walletTotal - gdpOpeningTotal))}
                </strong>{" "}
                in GDP growth.
              </>
            ) : (
              <>Server GDP (sum of wallets) is <strong>{money(walletTotal)}</strong>.</>
            )}
          </p>
        </div>
      ),
    },
    {
      title: "Step 3 — Tax rates (marginal bands)",
      body: (
        <div className="space-y-3 text-sm leading-relaxed text-sky-950">
          <p>
            You set <strong>progressive bands</strong>: each slice of a player&apos;s modeled employment income is taxed at
            the rate for that slice.
          </p>
          {brackets.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-sky-300/90 bg-white/90 shadow-sm">
              <p className="border-b border-sky-200 bg-sky-100/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-900">
                Your draft bands
              </p>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-sky-200 text-left text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                    <th className="px-3 py-2">Band</th>
                    <th className="px-3 py-2">Income ceiling</th>
                    <th className="px-3 py-2 text-right">Marginal rate</th>
                  </tr>
                </thead>
                <tbody>
                  {brackets.map((b, i) => (
                    <tr key={i} className="border-b border-sky-100 last:border-b-0">
                      <td className="px-3 py-2 font-medium text-sky-950">{i + 1}</td>
                      <td className="px-3 py-2 font-mono tabular-nums text-sky-900">
                        {b.ceiling == null ? "∞ (top)" : money(b.ceiling)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold text-sky-950">
                        {(Number(b.rate) * 100).toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              No bands in this draft yet — add marginal brackets in the tax section below.
            </p>
          )}
          <p className="text-xs leading-relaxed text-sky-900/90">
            Raising rates or lowering ceilings generally increases revenue (and player friction); lowering rates does the
            opposite. The full bracket table on the page updates live from your draft.
          </p>
          <button
            type="button"
            className="text-sm font-semibold text-sky-900 underline"
            onClick={() => scrollToId("federal-budget-tax")}
          >
            Jump to tax editor
          </button>
        </div>
      ),
    },
    {
      title: "Step 4 — Deficit or surplus (this draft)",
      body: (
        <div className="space-y-2 text-sm leading-relaxed text-sky-950">
          <p>
            Treasury is still collecting income tax for the current fiscal year, <strong>{yearLabel}</strong>. The president
            is drafting the budget for the <strong>upcoming</strong> <strong>{budgetTargetYearLabel}</strong>.
          </p>
          <p>
            For <strong>{budgetTargetYearLabel}</strong>, estimated income tax from the live bracket model (hourly scheduled
            pay vs your draft bands, then × <strong>72</strong> sim-hours for an RP-year planning view —{" "}
            <strong>not</strong> wallet balances or cash receipts) is <strong>{money(estimatedTaxYtd)}</strong>. This draft
            appropriates <strong>{money(totalAllocated)}</strong> for the <strong>{budgetTargetYearLabel}</strong> budget.
          </p>
          <p>
            The bracket preview shows a{" "}
            <strong className={draftNetTaxVsAppropriations >= 0 ? "text-emerald-900" : "text-rose-900"}>
              {draftNetTaxVsAppropriations >= 0 ? "surplus" : "deficit"}
            </strong>{" "}
            of{" "}
            <strong className={draftNetTaxVsAppropriations >= 0 ? "text-emerald-900" : "text-rose-900"}>
              {money(Math.abs(draftNetTaxVsAppropriations))}
            </strong>
            .
          </p>
          <p>
            {treasuryBalance < 0 ? (
              <>
                This is an estimated read of how the books stack up: <strong>federal treasury (cumulative shortage)</strong> is{" "}
                <strong>{money(-treasuryBalance)}</strong> — the Treasury tile (prior closed years plus this year&apos;s cash
                gap vs. appropriations). That is <strong>not</strong> the <strong>{budgetTargetYearLabel}</strong> bracket
                preview in the line above; do not add or subtract those two figures.
              </>
            ) : (
              <>
                <strong>Federal treasury (cumulative shortage)</strong> shows <strong>no</strong> net deficit on the books
                right now. The bracket preview for <strong>{budgetTargetYearLabel}</strong> is still only modeled tax vs. this
                draft.
              </>
            )}
          </p>
          <button
            type="button"
            className="text-sm font-semibold text-sky-900 underline"
            onClick={() => scrollToId("federal-budget-analytics")}
          >
            Jump to budget analytics
          </button>
        </div>
      ),
    },
    {
      title: "Step 5 — Line items, minimums, and national metrics",
      body: (
        <div className="space-y-2 text-sm leading-relaxed text-sky-950">
          <p>
            Each program has a <strong>minimum</strong> (baseline) and <strong>allocated</strong> spend. Anything above the
            minimum is <strong>surplus</strong> that nudges linked national metrics in the live preview (approval, poverty,
            unemployment, etc.).
          </p>
          <button
            type="button"
            className="text-sm font-semibold text-sky-900 underline"
            onClick={() => scrollToId("federal-budget-lines")}
          >
            Jump to line items
          </button>{" "}
          <button
            type="button"
            className="text-sm font-semibold text-sky-900 underline"
            onClick={() => scrollToId("federal-budget-metrics")}
          >
            Jump to metrics preview
          </button>
        </div>
      ),
    },
    {
      title: "Step 6 — Ship the budget",
      body: (
        <ul className="list-inside list-disc space-y-1 text-sm leading-relaxed text-sky-950">
          <li>Save draft while iterating.</li>
          <li>Open Review as appropriations bill, then file to the House hopper.</li>
          <li>Congress passes it; President signs enrolled act — that submits the workbook and unlocks the economy gate.</li>
        </ul>
      ),
    },
  ];

  const last = steps.length - 1;

  return (
    <section className="rounded border border-sky-400 bg-sky-50 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-sky-950">Federal budget walkthrough</h2>
        <button type="button" className="text-xs font-semibold text-sky-800 underline" onClick={finish}>
          Don&apos;t show again (this browser)
        </button>
      </div>
      <p className="mt-1 text-xs text-sky-900/90">
        Step {step + 1} of {steps.length} — use Next / Back. This replaces the old single-page bullet list for Presidents.
      </p>
      <div className="mt-4 border-t border-sky-200/80 pt-4">
        <h3 className="text-base font-semibold text-sky-950">{steps[step]?.title}</h3>
        <div className="mt-2">{steps[step]?.body}</div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={step <= 0}
          className="rounded border border-sky-600 bg-white px-3 py-1.5 text-sm font-semibold text-sky-950 disabled:opacity-40"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          Back
        </button>
        <div className="flex gap-1">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${i === step ? "bg-sky-700" : "bg-sky-300"}`}
              aria-hidden
            />
          ))}
        </div>
        {step < last ? (
          <button
            type="button"
            className="rounded border border-sky-700 bg-sky-700 px-3 py-1.5 text-sm font-semibold text-white"
            onClick={() => setStep((s) => Math.min(last, s + 1))}
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            className="rounded border border-emerald-800 bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white"
            onClick={finish}
          >
            Done
          </button>
        )}
      </div>
    </section>
  );
}
