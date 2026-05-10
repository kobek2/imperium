"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  applyServerGdpInflationToLineMinima,
  fileFederalBudgetAppropriationsBill,
  saveFiscalBudgetDraft,
  type FiscalLineItemRow,
  type FiscalTaxBracketRow,
} from "@/app/actions/fiscal";
import type { PriorFiscalYearBudgetSummary } from "@/lib/fiscal-budget-types";
import { BillBody } from "@/components/bill-body";
import { NavRouteButton } from "@/components/nav-route-button";
import { NationalMetricsDisplay } from "@/components/national-metrics-display";
import { FederalBudgetInteractiveTutorial } from "@/components/federal-budget-interactive-tutorial";
import type { FederalBudgetPriorYearTutorialContext } from "@/lib/federal-budget-tutorial-types";
import { buildFederalAppropriationsBillHtml } from "@/lib/build-federal-appropriations-bill-html";
import { buildBracketAnalytics } from "@/lib/load-fiscal-tax-analytics";
import {
  budgetSurplusTiers,
  computeServerGdpIndexRatio,
  lineItemDefaultLabel,
  lineItemFocus,
  surplusAboveMinimum,
} from "@/lib/line-item-budget-effects";
import type { NationalMetricsRow } from "@/lib/national-metrics-types";
import { computeMarginalIncomeTax, type FiscalTaxBracket } from "@/lib/fiscal-tax";
import { computeBudgetInfluencedNationalMetrics } from "@/lib/national-metrics-from-budget";
import { sanitizeBillHtml } from "@/lib/sanitize-bill-html";
import { TaxBracketAnalyticsTable } from "./tax-bracket-analytics-table";

type BudgetRow = {
  status: string;
  tax_brackets: unknown;
  line_items: unknown;
  metrics: unknown;
};

export function FederalBudgetPanel({
  fiscalYearId,
  yearLabel,
  fiscalYearIndex,
  yearStartedAt,
  appropriationDeadlineAt,
  appropriationsEnrolled,
  appropriationClockStartedAt,
  taxPaidYtd,
  playersTaxPaidActiveFy,
  governmentShutdown,
  gdpOpeningTotal,
  walletTotal,
  budget,
  treasuryBalance,
  isPresident,
  isAdmin,
  isTreasurySecretary = false,
  closedFiscalYears,
  taxBaseWalletBalances,
  nationalMetrics,
  priorYearBudgetSummary,
  showInteractiveFederalTutorial = false,
  walkthroughForced = false,
  priorYearTutorial = null,
}: {
  fiscalYearId: string;
  yearLabel: string;
  /** Active `rp_fiscal_years.year_index` (Treasury collects for this FY; budget walkthrough copy targets FY index + 1). */
  fiscalYearIndex: number;
  yearStartedAt: string;
  /** IRL deadline to enroll appropriations for new fiscal years (null on legacy FY rows). */
  appropriationDeadlineAt: string | null;
  appropriationsEnrolled: boolean;
  appropriationClockStartedAt: string | null;
  /** Sum of fiscal_tax_accounts.paid_amount for this FY (cash income tax in). */
  taxPaidYtd: number;
  /** Count of accounts with paid_amount > 0 this FY. */
  playersTaxPaidActiveFy: number;
  governmentShutdown: boolean;
  gdpOpeningTotal: number | null;
  walletTotal: number;
  budget: BudgetRow | null;
  /** Negative when cumulative enacted spending has outpaced tax collected (closed FY shortfalls + this FY gap). */
  treasuryBalance: number;
  isPresident: boolean;
  isAdmin: boolean;
  /** Treasury secretary may view the full workbook (tax + lines) without President/admin staff flags. */
  isTreasurySecretary?: boolean;
  closedFiscalYears: Array<{
    year_index: number;
    label: string;
    closed_at: string | null;
    gdp_opening_total: number | null;
    gdp_closing_total: number | null;
  }>;
  /** Per-player wallet balances for the current server state (all players, not only hourly collectors). */
  taxBaseWalletBalances: number[];
  nationalMetrics: NationalMetricsRow | null;
  /** Latest closed FY appropriations + estimated tax (for YoY). Null if no closed year on file. */
  priorYearBudgetSummary: PriorFiscalYearBudgetSummary | null;
  /** President: first FY on server, or `?walkthrough=budget`. */
  showInteractiveFederalTutorial?: boolean;
  walkthroughForced?: boolean;
  priorYearTutorial?: FederalBudgetPriorYearTutorialContext | null;
}) {
  const budgetSubmitted = budget?.status === "submitted";
  const canEdit = (isPresident && !budgetSubmitted) || isAdmin;
  const showFullProcess = isPresident || isAdmin;
  const showFullProcessForTour = showFullProcess || Boolean(isTreasurySecretary);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);

  const initialBrackets = useMemo((): FiscalTaxBracketRow[] => {
    const raw = budget?.tax_brackets;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((b) => ({
        ceiling: b && typeof b === "object" && "ceiling" in b && (b as { ceiling?: unknown }).ceiling != null
          ? Number((b as { ceiling: unknown }).ceiling)
          : null,
        rate: Number((b as { rate?: unknown }).rate ?? 0),
      }));
    }
    return [
      { ceiling: 20_000, rate: 0 },
      { ceiling: 50_000, rate: 0.025 },
      { ceiling: 100_000, rate: 0.05 },
      { ceiling: 200_000, rate: 0.15 },
      { ceiling: null, rate: 0.405 },
    ];
  }, [budget?.tax_brackets]);

  const initialLines = useMemo((): FiscalLineItemRow[] => {
    const raw = budget?.line_items;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((row) => ({
        key: String((row as { key?: unknown }).key ?? ""),
        label: String((row as { label?: unknown }).label ?? ""),
        base_minimum: Number((row as { base_minimum?: unknown }).base_minimum ?? (row as { minimum?: unknown }).minimum ?? 0),
        minimum: Number((row as { minimum?: unknown }).minimum ?? 0),
        allocated: Number((row as { allocated?: unknown }).allocated ?? 0),
      }));
    }
    return [];
  }, [budget?.line_items]);

  const [brackets, setBrackets] = useState<FiscalTaxBracketRow[]>(initialBrackets);
  const [lines, setLines] = useState<FiscalLineItemRow[]>(initialLines);
  const [billPreviewOpen, setBillPreviewOpen] = useState(false);

  const liveBracketAnalytics = useMemo(
    () => buildBracketAnalytics(taxBaseWalletBalances, brackets as FiscalTaxBracket[]),
    [taxBaseWalletBalances, brackets],
  );

  const appropriationsPreviewHtml = useMemo(() => {
    const normalized = lines.map((row) => ({ ...row, label: lineItemDefaultLabel(row.key) }));
    return sanitizeBillHtml(
      buildFederalAppropriationsBillHtml({
        yearLabel,
        taxBrackets: brackets,
        lineItems: normalized,
      }),
    );
  }, [yearLabel, brackets, lines]);

  const sampleIncome = 100_000;
  const sampleTax = useMemo(
    () => computeMarginalIncomeTax(sampleIncome, brackets as FiscalTaxBracket[]),
    [brackets],
  );

  const gdpGrowthSinceStart =
    gdpOpeningTotal != null ? walletTotal - gdpOpeningTotal : null;
  const gdpIndexRatio = useMemo(
    () => computeServerGdpIndexRatio(walletTotal, gdpOpeningTotal),
    [walletTotal, gdpOpeningTotal],
  );

  const totalAllocated = useMemo(() => lines.reduce((s, l) => s + (Number.isFinite(l.allocated) ? l.allocated : 0), 0), [lines]);

  const totalMinimum = useMemo(
    () => lines.reduce((s, l) => s + (Number.isFinite(l.minimum) ? l.minimum : 0), 0),
    [lines],
  );

  const aggregateSurplusOverMinimum = useMemo(() => Math.max(0, totalAllocated - totalMinimum), [totalAllocated, totalMinimum]);

  const estimatedTaxYtd = liveBracketAnalytics.totalTax;
  const taxableSalaryIncomeYtd = liveBracketAnalytics.totalIncome;
  const draftNetTaxVsAppropriations = estimatedTaxYtd - totalAllocated;
  const cashRemainingVsSpend = Math.max(0, totalAllocated - taxPaidYtd);
  const cashSurplusDeficit = taxPaidYtd - totalAllocated;
  const canFileAppropriationsBill =
    !appropriationsEnrolled &&
    budget?.status === "draft" &&
    (isAdmin || Boolean(appropriationClockStartedAt));

  const metricsFromBudgetPreview = useMemo(
    () => computeBudgetInfluencedNationalMetrics(nationalMetrics, lines, fiscalYearId),
    [nationalMetrics, lines, fiscalYearId],
  );

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      setFlash(null);
      const r = await fn();
      setFlash({ ok: r.ok, message: r.message });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      {flash ? (
        <p
          role="status"
          className={`rounded border px-3 py-2 text-sm ${
            flash.ok
              ? "border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-ink)_4%,transparent)]"
              : "border-rose-300 bg-rose-50 text-rose-950"
          }`}
        >
          {flash.message}
        </p>
      ) : null}

      {isAdmin && !isPresident ? (
        <div className="rounded border border-slate-400/80 bg-slate-50 p-4 text-sm text-slate-900">
          <p className="font-semibold text-[var(--psc-ink)]">Admin view</p>
          <p className="mt-2 leading-relaxed text-slate-800">
            You can see the full budget process, tax brackets, line items, metrics, and fiscal history. Admins may edit
            drafts, file appropriations, and close fiscal years alongside the President.
          </p>
        </div>
      ) : null}

      {budgetSubmitted && isPresident && !isAdmin ? (
        <div className="rounded border border-sky-600/50 bg-sky-50 p-4 text-sm text-sky-950">
          <p className="font-semibold">Budget adopted</p>
          <p className="mt-2 leading-relaxed">
            This year&apos;s workbook is locked while it is law. Draft the <strong>next</strong> cycle after staff close the
            fiscal year and open the new active year, or ask full staff if a correction is required.
          </p>
        </div>
      ) : null}

      {appropriationDeadlineAt && !appropriationsEnrolled ? (
        <div
          className={`rounded border p-4 text-sm ${
            governmentShutdown
              ? "border-rose-600 bg-rose-50 text-rose-950"
              : "border-amber-600 bg-amber-50 text-amber-950"
          }`}
        >
          <p className="font-semibold">{governmentShutdown ? "Economy frozen (staff)" : "Appropriations countdown"}</p>
          <p className="mt-2 leading-relaxed">
            {governmentShutdown ? (
              <>
                Staff set <strong>economy freeze</strong> on the active fiscal year. Congress and the executive still pass
                bills normally; wallet collects and related economy actions stay blocked until administrators clear the freeze
                after appropriations are in place (or as your sim policy directs).
              </>
            ) : (
              <>
                Staff started a real-time appropriations window ending{" "}
                <span className="font-mono font-semibold">{new Date(appropriationDeadlineAt).toLocaleString()}</span> (IRL).
                Members may still propose and vote on ordinary bills; the President typically files the House appropriations
                measure first, then the Treasury Secretary may file if needed. Passing deadline does <strong>not</strong>{" "}
                auto-freeze the economy — staff use Admin → Economy overview to freeze if the act is not yet law. Signing the
                enrolled bill marks the budget workbook submitted automatically.
              </>
            )}
          </p>
        </div>
      ) : null}

      <section className="grid gap-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Active fiscal year</p>
          <p className="mt-1 text-lg font-semibold text-[var(--psc-ink)]">{yearLabel}</p>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">Started {new Date(yearStartedAt).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
            Federal treasury (cumulative shortage)
          </p>
          <p
            className={`mt-1 font-mono text-xl font-semibold tabular-nums ${
              treasuryBalance <= 0 ? "text-[var(--psc-ink)]" : "text-emerald-900"
            }`}
          >
            ${treasuryBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">GDP (sum of player wallets)</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--psc-ink)]">
            ${walletTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Growth since FY start</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--psc-ink)]">
            {gdpGrowthSinceStart == null
              ? "—"
              : `${gdpGrowthSinceStart >= 0 ? "+" : ""}$${gdpGrowthSinceStart.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          </p>
        </div>
      </section>

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Budget status</h2>
        <p className="mt-2 text-sm text-[var(--psc-muted)]">
          Status:{" "}
          <span className="font-semibold text-[var(--psc-ink)]">
            {budgetSubmitted ? "Adopted (submitted) — workbook locked for the President" : "Draft — in progress"}
          </span>
        </p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
              Total allocated ({yearLabel})
            </dt>
            <dd className="mt-1 font-mono font-semibold tabular-nums text-[var(--psc-ink)]">
              ${totalAllocated.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </dd>
          </div>
          <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
              Total collected (income tax paid in)
            </dt>
            <dd className="mt-1 font-mono font-semibold tabular-nums text-[var(--psc-ink)]">
              ${taxPaidYtd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </dd>
          </div>
          <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Total remaining</dt>
            <dd className="mt-1 font-mono font-semibold tabular-nums text-[var(--psc-ink)]">
              ${cashRemainingVsSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </dd>
          </div>
          <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
              Cash surplus / deficit (this FY)
            </dt>
            <dd
              className={`mt-1 font-mono font-semibold tabular-nums ${
                cashSurplusDeficit >= 0 ? "text-emerald-900" : "text-rose-900"
              }`}
            >
              {cashSurplusDeficit >= 0 ? "+" : ""}$
              {cashSurplusDeficit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </dd>
          </div>
        </dl>
      </section>

      {showFullProcessForTour ? (
        <>
          <FederalBudgetInteractiveTutorial
            show={Boolean(showInteractiveFederalTutorial)}
            walkthroughForced={walkthroughForced}
            yearLabel={yearLabel}
            fiscalYearIndex={fiscalYearIndex}
            priorYear={priorYearTutorial}
            walletTotal={walletTotal}
            gdpOpeningTotal={gdpOpeningTotal}
            taxPaidYtd={taxPaidYtd}
            playersTaxPaidActiveFy={playersTaxPaidActiveFy}
            estimatedTaxYtd={estimatedTaxYtd}
            totalAllocated={totalAllocated}
            draftNetTaxVsAppropriations={draftNetTaxVsAppropriations}
            treasuryBalance={treasuryBalance}
            brackets={brackets}
          />

          <section
            id="federal-budget-tax"
            className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6"
          >
            <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Progressive income tax (fiscal year)</h2>
            <p className="text-xs text-[var(--psc-muted)]">
              Sample: $100,000 gross inflows → tax ${sampleTax.toLocaleString(undefined, { maximumFractionDigits: 0 })} (
              {sampleIncome > 0 ? ((sampleTax / sampleIncome) * 100).toFixed(2) : "0"}% effective).
            </p>
            <div className="space-y-2">
              {brackets.map((b, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--psc-muted)]">Band {i + 1}</span>
                  <label className="text-xs">
                    Ceiling ($)
                    <input
                      type="number"
                      readOnly={!canEdit}
                      className="ml-1 w-28 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2 py-1 font-mono text-sm read-only:opacity-90"
                      value={b.ceiling == null ? "" : b.ceiling}
                      placeholder="∞ top"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        const next = [...brackets];
                        next[i] = {
                          ...next[i]!,
                          ceiling: v === "" ? null : Number(v),
                        };
                        setBrackets(next);
                      }}
                    />
                  </label>
                  <label className="text-xs">
                    Rate (decimal)
                    <input
                      type="number"
                      step="0.001"
                      readOnly={!canEdit}
                      className="ml-1 w-24 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2 py-1 font-mono text-sm read-only:opacity-90"
                      value={b.rate}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      onChange={(e) => {
                        const next = [...brackets];
                        next[i] = { ...next[i]!, rate: Number(e.target.value) };
                        setBrackets(next);
                      }}
                    />
                  </label>
                  {canEdit ? (
                    <button
                      type="button"
                      className="text-xs text-rose-700 underline"
                      onClick={() => setBrackets(brackets.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
              {canEdit ? (
                <button
                  type="button"
                  className="text-sm font-semibold text-[var(--psc-accent)] underline"
                  onClick={() => setBrackets([...brackets, { ceiling: null, rate: 0 }])}
                >
                  Add band
                </button>
              ) : null}
            </div>

            {liveBracketAnalytics.bands.length > 0 ? (
              <div className="mt-6 space-y-2">
                <h3 className="text-sm font-semibold text-[var(--psc-ink)]">
                  Bracket impact (all player wallet balances × draft brackets)
                </h3>
                <TaxBracketAnalyticsTable
                  bands={liveBracketAnalytics.bands}
                  totalIncome={liveBracketAnalytics.totalIncome}
                  totalTax={liveBracketAnalytics.totalTax}
                  playerCountWithIncome={liveBracketAnalytics.playerCountWithIncome}
                />
              </div>
            ) : (
              <p className="mt-4 text-xs text-[var(--psc-muted)]">Add at least one tax band to see bracket impact.</p>
            )}
          </section>

          <section
            id="federal-budget-lines"
            className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6"
          >
            <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Line items (minimum + allocated)</h2>
            <p className="text-xs text-[var(--psc-muted)]">
              Spending at <strong className="text-[var(--psc-ink)]">minimum</strong> holds baseline national metrics.{" "}
              <strong className="text-[var(--psc-ink)]">Surplus</strong> above minimum adds improvement tiers toward the linked
              areas (display-only; admins set the actual numbers on the nation).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--psc-border)] text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
                    <th className="py-2 pr-2">Key</th>
                    <th className="py-2 pr-2">Program</th>
                    <th className="py-2 pr-2">Minimum</th>
                    <th className="py-2 pr-2">Allocated</th>
                    <th className="py-2 pr-2">Surplus</th>
                    <th className="py-2 pr-2">Effect vs min</th>
                    <th className="py-2">Metric focus</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => {
                    const surplus = surplusAboveMinimum(line.allocated, line.minimum);
                    const fx = budgetSurplusTiers(surplus);
                    return (
                      <tr key={line.key || i} className="border-b border-[var(--psc-border)]/60 align-top">
                        <td className="py-2 pr-2 font-mono text-xs">{line.key}</td>
                        <td className="py-2 pr-2 text-sm text-[var(--psc-ink)]">{lineItemDefaultLabel(line.key)}</td>
                        <td className="py-2 pr-2">
                          <input
                            type="number"
                            readOnly={!canEdit}
                            className="w-full rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2 py-1 font-mono text-sm read-only:opacity-90"
                            value={line.minimum}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                            onChange={(e) => {
                              const next = [...lines];
                              const minimum = Number(e.target.value);
                              next[i] = { ...next[i]!, minimum, base_minimum: minimum };
                              setLines(next);
                            }}
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            type="number"
                            readOnly={!canEdit}
                            className="w-full rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2 py-1 font-mono text-sm read-only:opacity-90"
                            value={line.allocated}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                            onChange={(e) => {
                              const next = [...lines];
                              next[i] = { ...next[i]!, allocated: Number(e.target.value) };
                              setLines(next);
                            }}
                          />
                        </td>
                        <td className="py-2 pr-2 font-mono text-xs tabular-nums text-[var(--psc-ink)]">
                          ${surplus.toLocaleString()}
                        </td>
                        <td className="py-2 pr-2 text-xs text-[var(--psc-muted)]">{fx.summary}</td>
                        <td className="py-2 text-xs text-[var(--psc-muted)]">{lineItemFocus(line.key)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div id="federal-budget-analytics" className="mt-6 space-y-4 border-t border-[var(--psc-border)] pt-6">
              <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Budget analytics (this draft)</h3>
              <p className="text-[10px] leading-relaxed text-[var(--psc-muted)]">
                Tax analytics here are modeled from the current wallet distribution across all players. Appropriations are the
                sum of your line items. Net (tax − appropriations) is a planning snapshot, not a full cash-flow model.
              </p>
              <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2.5">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    Total appropriations
                  </dt>
                  <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--psc-ink)]">
                    ${totalAllocated.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </dd>
                </div>
                <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2.5">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    Minimum floor (sum)
                  </dt>
                  <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--psc-ink)]">
                    ${totalMinimum.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </dd>
                </div>
                <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2.5">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    Surplus over minimum
                  </dt>
                  <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--psc-ink)]">
                    ${aggregateSurplusOverMinimum.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </dd>
                </div>
                <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2.5">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    Est. income tax (draft brackets × all player wallet balances)
                  </dt>
                  <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--psc-ink)]">
                    ${estimatedTaxYtd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </dd>
                </div>
                <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2.5">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    Tax base (all player wallet balances)
                  </dt>
                  <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--psc-ink)]">
                    ${taxableSalaryIncomeYtd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </dd>
                  <dd className="mt-0.5 text-[10px] text-[var(--psc-muted)]">
                    {taxBaseWalletBalances.length} player
                    {taxBaseWalletBalances.length === 1 ? "" : "s"} included
                  </dd>
                </div>
                <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2.5">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    Est. net (tax − appropriations)
                  </dt>
                  <dd
                    className={`mt-1 font-mono text-base font-semibold tabular-nums ${
                      draftNetTaxVsAppropriations >= 0 ? "text-emerald-900" : "text-rose-900"
                    }`}
                  >
                    {draftNetTaxVsAppropriations >= 0 ? "+" : ""}$
                    {draftNetTaxVsAppropriations.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </dd>
                </div>
                <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2.5">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    Federal treasury (now)
                  </dt>
                  <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--psc-ink)]">
                    ${treasuryBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </dd>
                </div>
                <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2.5">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    Server GDP index ratio
                  </dt>
                  <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--psc-ink)]">
                    {gdpIndexRatio.toFixed(3)}x
                  </dd>
                  <dd className="mt-0.5 text-[10px] text-[var(--psc-muted)]">
                    Wallet sum / FY opening GDP (auto-applied to line minima on save/file).
                  </dd>
                </div>
              </dl>

              {priorYearBudgetSummary ? (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    vs last closed year ({priorYearBudgetSummary.yearLabel})
                  </h4>
                  <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded border border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-ink)_4%,transparent)] px-3 py-2.5">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                        Their total appropriations
                      </dt>
                      <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--psc-ink)]">
                        ${priorYearBudgetSummary.totalAppropriations.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </dd>
                      <dd className="mt-1 text-[10px] text-[var(--psc-muted)]">
                        Δ this draft:{" "}
                        <span
                          className={`font-mono font-semibold ${
                            totalAllocated - priorYearBudgetSummary.totalAppropriations >= 0
                              ? "text-rose-900"
                              : "text-emerald-900"
                          }`}
                        >
                          {totalAllocated - priorYearBudgetSummary.totalAppropriations >= 0 ? "+" : ""}$
                          {(totalAllocated - priorYearBudgetSummary.totalAppropriations).toLocaleString(undefined, {
                            maximumFractionDigits: 0,
                          })}
                        </span>{" "}
                        vs that year
                      </dd>
                    </div>
                    <div className="rounded border border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-ink)_4%,transparent)] px-3 py-2.5">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                        Their income tax (closed year, actual)
                      </dt>
                      <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--psc-ink)]">
                        ${priorYearBudgetSummary.estimatedIncomeTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </dd>
                      <dd className="mt-1 text-[10px] text-[var(--psc-muted)]">
                        Draft preview (FY-to-date now) minus that closed-year total:{" "}
                        <span className="font-mono font-semibold text-[var(--psc-ink)]">
                          {estimatedTaxYtd - priorYearBudgetSummary.estimatedIncomeTax >= 0 ? "+" : ""}$
                          {(estimatedTaxYtd - priorYearBudgetSummary.estimatedIncomeTax).toLocaleString(undefined, {
                            maximumFractionDigits: 0,
                          })}
                        </span>{" "}
                        (rough; current year still open)
                      </dd>
                    </div>
                    <div className="rounded border border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-ink)_4%,transparent)] px-3 py-2.5">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                        Their taxable base (closed year, historical)
                      </dt>
                      <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-[var(--psc-ink)]">
                        $
                        {priorYearBudgetSummary.totalTaxableSalaryIncome.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                      </dd>
                      <dd className="mt-0.5 text-[10px] text-[var(--psc-muted)]">
                        {priorYearBudgetSummary.playersWithIncome} with income that year
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <p className="text-xs text-[var(--psc-muted)]">
                  After the first fiscal year closes, last year&apos;s appropriations and estimated tax show here for comparison.
                </p>
              )}
            </div>
          </section>

          <section id="federal-budget-metrics" className="space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
            <h2 className="text-lg font-semibold text-[var(--psc-ink)]">National metrics (simulator)</h2>
            <NationalMetricsDisplay m={metricsFromBudgetPreview} />
            {isAdmin ? (
              <p className="text-[10px] text-[var(--psc-muted)]">
                Admin baseline (persisted): approval{' '}
                {nationalMetrics?.government_approval != null
                  ? `${Number(nationalMetrics.government_approval).toFixed(1)}%`
                  : "—"}
                .
              </p>
            ) : null}
            <p className="text-[10px] text-[var(--psc-muted)]">
              Model note: transparent surplus rules are easy to tune; later you might prefer macro + lagged indicators, deficit
              feedback, or scripted events instead of linear bumps.
            </p>
          </section>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={pending || !canEdit}
              className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
              onClick={() => {
                run(() =>
                  saveFiscalBudgetDraft({
                    fiscalYearId,
                    taxBrackets: brackets,
                    lineItems: lines,
                  }),
                );
              }}
            >
              {pending ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              disabled={pending || !canEdit || budgetSubmitted}
              className="rounded border border-indigo-800/40 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-950 disabled:opacity-50"
              onClick={() => setBillPreviewOpen(true)}
            >
              Review as appropriations bill
            </button>
            {budget?.status === "draft" ? (
              <button
                type="button"
                disabled={pending || !canEdit}
                title="Syncs line minima to server GDP index (wallet sum / FY opening GDP), preserving base minima to avoid compounding."
                className="rounded border border-emerald-800/40 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50"
                onClick={() => run(() => applyServerGdpInflationToLineMinima())}
              >
                {pending ? "Updating…" : "Inflate line minima (GDP)"}
              </button>
            ) : null}
          </div>

          {billPreviewOpen ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="appropriations-preview-title"
            >
              <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 shadow-lg">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 id="appropriations-preview-title" className="text-lg font-semibold text-[var(--psc-ink)]">
                    Appropriations bill preview
                  </h2>
                  <button
                    type="button"
                    className="text-sm font-semibold text-[var(--psc-muted)] underline"
                    onClick={() => setBillPreviewOpen(false)}
                  >
                    Close
                  </button>
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--psc-muted)]">
                  <span>
                    Formatted like legislation on the floor. Filing sends it to the House leadership bill hopper as{' '}
                    <strong className="text-[var(--psc-ink)]">submitted</strong> (Speaker / leadership workflow).
                  </span>
                  <NavRouteButton href="/congress/leadership" className="px-2 py-1 text-xs">
                    Open leadership hopper
                  </NavRouteButton>
                </p>
                <BillBody content_html={appropriationsPreviewHtml} content_md={null} className="mt-4" />
                <div className="mt-6 flex flex-wrap gap-3 border-t border-[var(--psc-border)] pt-4">
                  <button
                    type="button"
                    className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-4 py-2 text-sm font-semibold"
                    onClick={() => setBillPreviewOpen(false)}
                  >
                    Back to editing
                  </button>
                  <button
                    type="button"
                    disabled={pending || !canFileAppropriationsBill}
                    title={
                      canFileAppropriationsBill
                        ? undefined
                        : isAdmin
                          ? "Cannot file while an appropriations act is enrolled or the budget is not a draft."
                          : "Staff must start the appropriations countdown (Admin → Economy overview) before filing to the hopper."
                    }
                    className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Save the current draft and file this appropriations bill to the House leadership hopper?",
                        )
                      ) {
                        return;
                      }
                      start(async () => {
                        setFlash(null);
                        const r = await fileFederalBudgetAppropriationsBill({
                          fiscalYearId,
                          yearLabel,
                          taxBrackets: brackets,
                          lineItems: lines,
                        });
                        setFlash({ ok: r.ok, message: r.message });
                        if (r.ok) {
                          setBillPreviewOpen(false);
                          router.refresh();
                        }
                      });
                    }}
                  >
                    {pending ? "Filing…" : "Confirm — save & file to House hopper"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {closedFiscalYears.length > 0 ? (
            <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
              <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Closed fiscal years</h2>
              <p className="mt-1 text-xs text-[var(--psc-muted)]">
                GDP snapshots are stored when the year closed (before federal income tax was settled for that year).
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--psc-border)] text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
                      <th className="py-2 pr-2">Year</th>
                      <th className="py-2 pr-2">Closed</th>
                      <th className="py-2 pr-2">GDP opening</th>
                      <th className="py-2">GDP closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedFiscalYears.map((row) => (
                      <tr key={row.year_index} className="border-b border-[var(--psc-border)]/60">
                        <td className="py-2 pr-2 font-medium text-[var(--psc-ink)]">{row.label}</td>
                        <td className="py-2 pr-2 text-[var(--psc-muted)]">
                          {row.closed_at ? new Date(row.closed_at).toLocaleString() : "—"}
                        </td>
                        <td className="py-2 pr-2 font-mono tabular-nums">
                          {row.gdp_opening_total == null
                            ? "—"
                            : `$${Number(row.gdp_opening_total).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                        </td>
                        <td className="py-2 font-mono tabular-nums">
                          {row.gdp_closing_total == null
                            ? "—"
                            : `$${Number(row.gdp_closing_total).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 text-sm text-[var(--psc-muted)]">
          Only the President and admins can view the full budget detail. You can still see GDP and treasury totals above. Admins:
          use the <span className="font-semibold text-[var(--psc-ink)]">admin</span> role to open the complete process.
        </section>
      )}
    </div>
  );
}
