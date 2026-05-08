import { redirect } from "next/navigation";
import { NavRouteButton } from "@/components/nav-route-button";
import { getServerAuth } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";
import { getStaffAccess } from "@/lib/staff-access";
import { buildBracketAnalytics, loadAnnualInflowsForFiscalYear, loadAnnualInflowsForFiscalYearWindow } from "@/lib/load-fiscal-tax-analytics";
import type { NationalMetricsRow } from "@/lib/national-metrics-types";
import { parseTaxBrackets } from "@/lib/fiscal-tax";
import { isPresident } from "@/lib/president";
import type { PriorFiscalYearBudgetSummary } from "@/lib/fiscal-budget-types";
import { FederalBudgetPanel } from "./federal-budget-panel";
import { FederalPriorYearSidebar, type FederalPriorYearSnapshot } from "./federal-prior-year-sidebar";

export default async function FederalEconomyPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Configure Supabase to use the federal budget.
      </div>
    );
  }

  if (!user) redirect("/login");

  const [{ data: activeYear }, { data: wallets }, { data: treasuryRow }, pres, isAdmin, staff] = await Promise.all([
    supabase.from("rp_fiscal_years").select("*").eq("status", "active").maybeSingle(),
    supabase.from("economy_wallets").select("balance"),
    supabase.from("federal_treasury").select("balance").eq("id", 1).maybeSingle(),
    isPresident(supabase, user.id),
    getIsAdmin(),
    getStaffAccess(),
  ]);

  const staffFull = Boolean(staff?.hasFullStaff);
  if (!pres && !isAdmin && !staffFull) {
    redirect("/economy");
  }

  const budgetStaffCapabilities = isAdmin || staffFull;
  const showFiscalHistory = pres || isAdmin || staffFull;
  const { data: closedFiscalYears } = showFiscalHistory
    ? await supabase
        .from("rp_fiscal_years")
        .select("year_index, label, closed_at, gdp_opening_total, gdp_closing_total")
        .eq("status", "closed")
        .order("year_index", { ascending: false })
        .limit(20)
    : { data: null };

  const walletTotal = (wallets ?? []).reduce((s, w) => s + Number((w as { balance: number }).balance ?? 0), 0);
  const treasuryBalance = Number((treasuryRow as { balance?: number } | null)?.balance ?? 0);

  const fy = activeYear as {
    id: string;
    label: string;
    started_at: string;
    gdp_opening_total: number | null;
    appropriation_deadline_at?: string | null;
    appropriations_act_bill_id?: string | null;
    economy_activity_frozen?: boolean | null;
  } | null;

  const governmentShutdown = Boolean(fy?.economy_activity_frozen);

  const { data: budgetRow } = fy
    ? await supabase.from("federal_budgets").select("*").eq("fiscal_year_id", fy.id).maybeSingle()
    : { data: null };

  const { data: nationalMetricsRow } = fy
    ? await supabase.from("national_metrics").select("*").eq("fiscal_year_id", fy.id).maybeSingle()
    : { data: null };

  let salaryAnnualIncomes: number[] = [];
  if (fy) {
    try {
      salaryAnnualIncomes = await loadAnnualInflowsForFiscalYear(supabase, fy.started_at);
    } catch {
      salaryAnnualIncomes = [];
    }
  }

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

  return (
    <div className="space-y-8 xl:relative xl:left-1/2 xl:w-[min(1400px,calc(100vw-3rem))] xl:max-w-none xl:-translate-x-1/2">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Economy</p>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Federal budget &amp; GDP</h1>
          <p className="mt-2 max-w-4xl text-sm text-[var(--psc-muted)]">
            One fiscal year is active at a time. Tax uses marginal brackets on each player&apos;s{" "}
            <strong>employment income</strong> for that fiscal year (scheduled role salary plus PAC hourly collects), not donations
            or transfers.
            Wallet activity is blocked only when staff freeze the economy (manual shutdown). Appropriations still follow the
            statutory clock; missing the deadline does not auto-freeze the simulation. Fiscal year-end tax, spending execution,
            and rollovers are intended to run through cabinet offices (e.g. Treasury), not a manual &quot;close year&quot;
            control on this page.
          </p>
        </div>
        <NavRouteButton href="/economy">Back to economy</NavRouteButton>
      </header>

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
              yearStartedAt={fy.started_at}
              appropriationDeadlineAt={fy.appropriation_deadline_at ?? null}
              appropriationsEnrolled={Boolean(fy.appropriations_act_bill_id)}
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
              showFiscalSimulationReset={staffFull}
              closedFiscalYears={
                (closedFiscalYears ?? []) as Array<{
                  year_index: number;
                  label: string;
                  closed_at: string | null;
                  gdp_opening_total: number | null;
                  gdp_closing_total: number | null;
                }>
              }
              salaryAnnualIncomes={salaryAnnualIncomes}
              nationalMetrics={nationalMetrics}
              priorYearBudgetSummary={priorYearBudgetSummary}
            />
          </div>
        </div>
      )}
    </div>
  );
}
