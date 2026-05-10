import { redirect } from "next/navigation";
import { AppropriationsCountdownBar } from "@/components/appropriations-countdown-bar";
import { NavRouteButton } from "@/components/nav-route-button";
import { getServerAuth } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";
import { getStaffAccess } from "@/lib/staff-access";
import { buildBracketAnalytics, loadAnnualInflowsForFiscalYearWindow } from "@/lib/load-fiscal-tax-analytics";
import type { NationalMetricsRow } from "@/lib/national-metrics-types";
import { parseTaxBrackets } from "@/lib/fiscal-tax";
import { isPresident } from "@/lib/president";
import type { PriorFiscalYearBudgetSummary } from "@/lib/fiscal-budget-types";
import type { FederalBudgetPriorYearTutorialContext } from "@/lib/federal-budget-tutorial-types";
import { FederalBudgetPanel } from "./federal-budget-panel";
import { FederalPriorYearSidebar, type FederalPriorYearSnapshot } from "./federal-prior-year-sidebar";

function sumLineItemsAllocated(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return raw.reduce((acc, row) => acc + Number((row as { allocated?: unknown }).allocated ?? 0), 0);
}

/** Preserve other federal-page query flags when toggling links. */
function federalEconomySearch(opts: { presidentWalkthrough: boolean }) {
  const q = new URLSearchParams();
  if (opts.presidentWalkthrough) q.set("walkthrough", "budget");
  const s = q.toString();
  return s ? `?${s}` : "";
}

export default async function FederalEconomyPage({
  searchParams,
}: {
  searchParams?: Promise<{ walkthrough?: string }>;
}) {
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Configure Supabase to use the federal budget.
      </div>
    );
  }

  if (!user) redirect("/login");

  const [{ data: activeYear }, { data: wallets }, pres, isAdmin, staff] = await Promise.all([
    supabase.from("rp_fiscal_years").select("*").eq("status", "active").maybeSingle(),
    supabase.from("economy_wallets").select("balance"),
    isPresident(supabase, user.id),
    getIsAdmin(),
    getStaffAccess(),
  ]);

  const staffFull = Boolean(staff?.hasFullStaff);
  const isTreasurySecretary = Boolean(staff?.roleKeys.includes("secretary_of_treasury"));
  if (!pres && !isAdmin && !staffFull && !isTreasurySecretary) {
    redirect("/economy");
  }

  const sp = searchParams ? await searchParams : {};
  const walkthroughForced = sp?.walkthrough === "budget";

  const budgetStaffCapabilities = isAdmin || staffFull;
  const showFiscalHistory = pres || isAdmin || staffFull || isTreasurySecretary;
  const { data: closedFiscalYears } = showFiscalHistory
    ? await supabase
        .from("rp_fiscal_years")
        .select("year_index, label, closed_at, gdp_opening_total, gdp_closing_total")
        .eq("status", "closed")
        .order("year_index", { ascending: false })
        .limit(20)
    : { data: null };

  const showInteractiveFederalTutorial =
    pres && (((closedFiscalYears ?? []).length === 0) || sp?.walkthrough === "budget");

  const walletTotal = (wallets ?? []).reduce((s, w) => s + Number((w as { balance: number }).balance ?? 0), 0);
  const fy = activeYear as {
    id: string;
    label: string;
    year_index: number;
    started_at: string;
    gdp_opening_total: number | null;
    appropriation_deadline_at?: string | null;
    appropriations_act_bill_id?: string | null;
    appropriation_clock_started_at?: string | null;
    economy_activity_frozen?: boolean | null;
  } | null;

  const governmentShutdown = Boolean(fy?.economy_activity_frozen);

  const { data: budgetRow } = fy
    ? await supabase.from("federal_budgets").select("*").eq("fiscal_year_id", fy.id).maybeSingle()
    : { data: null };

  const { data: taxAccountRows } = fy
    ? await supabase.from("fiscal_tax_accounts").select("paid_amount").eq("fiscal_year_id", fy.id)
    : { data: null };
  let taxPaidYtdActiveFy = 0;
  let playersTaxPaidActiveFy = 0;
  for (const row of taxAccountRows ?? []) {
    const paid = Number((row as { paid_amount?: number }).paid_amount ?? 0);
    taxPaidYtdActiveFy += paid;
    if (paid > 0) playersTaxPaidActiveFy += 1;
  }

  const { data: closedFyIds } = await supabase.from("rp_fiscal_years").select("id").eq("status", "closed");
  const closedIds = (closedFyIds ?? []).map((r) => String((r as { id: string }).id)).filter(Boolean);
  let closedShortfallSum = 0;
  if (closedIds.length > 0) {
    const { data: closeRows, error: closeSumErr } = await supabase
      .from("fiscal_year_close_summaries")
      .select("appropriations_total, tax_collected_total")
      .in("fiscal_year_id", closedIds);
    if (!closeSumErr && closeRows) {
      for (const row of closeRows) {
        const r = row as { appropriations_total?: number | null; tax_collected_total?: number | null };
        const spend = Number(r.appropriations_total ?? 0);
        const tax = Number(r.tax_collected_total ?? 0);
        // Same as DB `greatest(0, spend - tax_collected)` at close. Do not rely on `spend_minus_tax_collected` alone:
        // it defaults to 0 for summaries written before that column existed.
        closedShortfallSum += Math.max(0, spend - tax);
      }
    }
  }

  const activeAllocatedPreview = budgetRow
    ? sumLineItemsAllocated((budgetRow as { line_items?: unknown }).line_items)
    : 0;
  const activeOperatingGap = Math.max(0, activeAllocatedPreview - taxPaidYtdActiveFy);
  /** Negative when cumulative enacted spending has outpaced cash collected (closed years + this FY gap). */
  const treasuryBalance = -(closedShortfallSum + activeOperatingGap);

  const { data: nationalMetricsRow } = fy
    ? await supabase.from("national_metrics").select("*").eq("fiscal_year_id", fy.id).maybeSingle()
    : { data: null };

  const walletBalances = (wallets ?? []).map((w) => Number((w as { balance?: number }).balance ?? 0));

  const nationalMetrics = (nationalMetricsRow as NationalMetricsRow | null) ?? null;

  const { data: priorFy } = await supabase
    .from("rp_fiscal_years")
    .select("id, label, year_index, started_at, closed_at, gdp_opening_total, gdp_closing_total")
    .eq("status", "closed")
    .order("year_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  let priorYearSnapshot: FederalPriorYearSnapshot | null = null;
  let priorYearBudgetSummary: PriorFiscalYearBudgetSummary | null = null;
  const prior = priorFy as {
    id: string;
    label: string;
    year_index: number;
    started_at: string;
    closed_at: string | null;
    gdp_opening_total: number | null;
    gdp_closing_total: number | null;
  } | null;
  if (prior?.closed_at) {
    try {
      const [priorIncomes, { data: priorBudget }] = await Promise.all([
        loadAnnualInflowsForFiscalYearWindow(supabase, prior.started_at, prior.closed_at),
        supabase.from("federal_budgets").select("tax_brackets, line_items").eq("fiscal_year_id", prior.id).maybeSingle(),
      ]);
      if (priorBudget) {
        const brackets = parseTaxBrackets((priorBudget as { tax_brackets: unknown }).tax_brackets);
        const analytics = buildBracketAnalytics(priorIncomes, brackets);
        const rawLines = (priorBudget as { line_items: unknown }).line_items;
        const priorLineItems: FederalPriorYearSnapshot["priorLineItems"] = Array.isArray(rawLines)
          ? rawLines.map((row) => ({
              key: String((row as { key?: unknown }).key ?? ""),
              minimum: Number((row as { minimum?: unknown }).minimum ?? 0),
              allocated: Number((row as { allocated?: unknown }).allocated ?? 0),
            }))
          : [];
        const priorAppropriations = priorLineItems.reduce((s, r) => s + (Number(r.allocated) || 0), 0);
        priorYearBudgetSummary = {
          yearLabel: prior.label,
          totalAppropriations: priorAppropriations,
          estimatedIncomeTax: analytics.totalTax,
          totalTaxableSalaryIncome: analytics.totalIncome,
          playersWithIncome: analytics.playerCountWithIncome,
        };
        priorYearSnapshot = {
          label: prior.label,
          yearIndex: prior.year_index,
          startedAt: prior.started_at,
          closedAt: prior.closed_at,
          gdp_opening_total: prior.gdp_opening_total != null ? Number(prior.gdp_opening_total) : null,
          gdp_closing_total: prior.gdp_closing_total != null ? Number(prior.gdp_closing_total) : null,
          bracketAnalytics: analytics,
          priorLineItems,
        };
      }
    } catch {
      priorYearSnapshot = null;
      priorYearBudgetSummary = null;
    }
  }

  let priorYearTutorial: FederalBudgetPriorYearTutorialContext | null = null;
  if (priorYearBudgetSummary && prior?.id) {
    const [{ data: closeSummary }, paidPlayersCountRes] = await Promise.all([
      supabase.from("fiscal_year_close_summaries").select("tax_collected_total").eq("fiscal_year_id", prior.id).maybeSingle(),
      supabase
        .from("fiscal_tax_accounts")
        .select("id", { count: "exact", head: true })
        .eq("fiscal_year_id", prior.id)
        .gt("paid_amount", 0),
    ]);
    const taxCollectedTotal = Number(
      (closeSummary as { tax_collected_total?: number | null } | null)?.tax_collected_total ?? 0,
    );
    const playersWithTaxPaid = paidPlayersCountRes.count ?? 0;

    priorYearTutorial = {
      yearLabel: priorYearBudgetSummary.yearLabel,
      totalAppropriations: priorYearBudgetSummary.totalAppropriations,
      estimatedIncomeTax: priorYearBudgetSummary.estimatedIncomeTax,
      impliedNet: priorYearBudgetSummary.estimatedIncomeTax - priorYearBudgetSummary.totalAppropriations,
      gdpOpening: priorYearSnapshot?.gdp_opening_total ?? null,
      gdpClosing: priorYearSnapshot?.gdp_closing_total ?? null,
      totalTaxableSalaryIncome: priorYearBudgetSummary.totalTaxableSalaryIncome,
      playersWithIncome: priorYearBudgetSummary.playersWithIncome,
      taxCollectedTotal,
      playersWithTaxPaid,
    };
  }

  return (
    <div className="space-y-8 xl:relative xl:left-1/2 xl:w-[min(1400px,calc(100vw-3rem))] xl:max-w-none xl:-translate-x-1/2">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Economy</p>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Federal budget &amp; GDP</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <NavRouteButton href="/economy">Back to economy</NavRouteButton>
          {pres ? (
            <NavRouteButton
              href={
                sp?.walkthrough === "budget"
                  ? `/economy/federal${federalEconomySearch({ presidentWalkthrough: false })}`
                  : `/economy/federal${federalEconomySearch({ presidentWalkthrough: true })}`
              }
              className="border-dashed border-sky-500/60 opacity-95"
            >
              {sp?.walkthrough === "budget" ? "Close budget walkthrough" : "Open budget walkthrough"}
            </NavRouteButton>
          ) : null}
        </div>
      </header>

      {fy ? (
        <div className="space-y-4">
          <div className="rounded border border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-accent)_6%,var(--psc-panel))] p-4 text-sm leading-relaxed text-[var(--psc-ink)]">
            <p className="font-semibold">Which year is this workbook?</p>
            <p className="mt-2 text-[var(--psc-muted)]">
              <strong>{fy.label}</strong> is the <strong>active</strong> federal row and tax year. You may keep a{" "}
              <strong>draft</strong> on this page anytime; once the budget is <strong>adopted (submitted)</strong>, line items
              and brackets are locked for the President until full staff override. To send the annual appropriations measure
              to the House hopper, staff must first start the <strong>appropriations countdown</strong> (Admin → Economy
              overview). When staff <strong>close</strong> this fiscal year, the next index becomes the new active year for
              collections and drafting.
            </p>
          </div>
          {!fy.appropriations_act_bill_id ? (
            <AppropriationsCountdownBar
              deadlineAt={fy.appropriation_deadline_at ?? null}
              enrolled={Boolean(fy.appropriations_act_bill_id)}
              economyFrozen={governmentShutdown}
            />
          ) : null}
        </div>
      ) : null}

      {!fy ? (
        <p className="text-sm text-[var(--psc-muted)]">No active fiscal year (database seed required).</p>
      ) : (
        <div
          className={
            priorYearSnapshot
              ? "flex flex-col gap-8 xl:grid xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] xl:items-start"
              : ""
          }
        >
          {priorYearSnapshot ? <FederalPriorYearSidebar snapshot={priorYearSnapshot} /> : null}
          <div className="min-w-0">
            <FederalBudgetPanel
              key={`${fy.id}-${String((budgetRow as { status?: string; updated_at?: string } | null)?.status ?? "")}-${String((budgetRow as { updated_at?: string } | null)?.updated_at ?? "")}-${String(nationalMetrics?.updated_at ?? "")}`}
              fiscalYearId={fy.id}
              yearLabel={fy.label}
              fiscalYearIndex={fy.year_index}
              yearStartedAt={fy.started_at}
              appropriationDeadlineAt={fy.appropriation_deadline_at ?? null}
              appropriationsEnrolled={Boolean(fy.appropriations_act_bill_id)}
              appropriationClockStartedAt={fy.appropriation_clock_started_at ?? null}
              taxPaidYtd={taxPaidYtdActiveFy}
              playersTaxPaidActiveFy={playersTaxPaidActiveFy}
              governmentShutdown={governmentShutdown}
              gdpOpeningTotal={fy.gdp_opening_total != null ? Number(fy.gdp_opening_total) : null}
              walletTotal={walletTotal}
              budget={
                budgetRow
                  ? {
                      status: String((budgetRow as { status: string }).status),
                      tax_brackets: (budgetRow as { tax_brackets: unknown }).tax_brackets,
                      line_items: (budgetRow as { line_items: unknown }).line_items,
                      metrics: (budgetRow as { metrics: unknown }).metrics,
                    }
                  : null
              }
              treasuryBalance={treasuryBalance}
              isPresident={pres}
              isAdmin={budgetStaffCapabilities}
              showInteractiveFederalTutorial={showInteractiveFederalTutorial}
              walkthroughForced={walkthroughForced}
              priorYearTutorial={priorYearTutorial}
              isTreasurySecretary={isTreasurySecretary}
              closedFiscalYears={
                (closedFiscalYears ?? []) as Array<{
                  year_index: number;
                  label: string;
                  closed_at: string | null;
                  gdp_opening_total: number | null;
                  gdp_closing_total: number | null;
                }>
              }
              taxBaseWalletBalances={walletBalances}
              nationalMetrics={nationalMetrics}
              priorYearBudgetSummary={priorYearBudgetSummary}
            />
          </div>
        </div>
      )}
    </div>
  );
}
