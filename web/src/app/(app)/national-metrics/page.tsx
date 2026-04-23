import { redirect } from "next/navigation";
import { NavRouteButton } from "@/components/nav-route-button";
import { NationalMetricsHub } from "@/components/national-metrics-hub";
import type { NationalMetricsHistoryRow, NationalMetricsRow } from "@/lib/national-metrics-types";
import { parseTaxBrackets, type FiscalTaxBracket } from "@/lib/fiscal-tax";
import { tryCreateClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";
import { isPresident } from "@/lib/president";

function marginalBandLabel(brackets: FiscalTaxBracket[], index: number): string {
  const prevTop =
    index === 0 ? 0 : brackets[index - 1]?.ceiling == null ? 0 : Number(brackets[index - 1]!.ceiling);
  const top = brackets[index]?.ceiling;
  const lo = `$${Number(prevTop).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (top == null || !Number.isFinite(Number(top))) {
    return `${lo} and above`;
  }
  const hi = `$${Number(top).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `${lo} – ${hi}`;
}

function MarginalTaxBracketsTable({ brackets }: { brackets: FiscalTaxBracket[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--psc-border)] text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
            <th className="py-2 pr-3">Taxable employment income (marginal slice)</th>
            <th className="py-2">Rate on that slice</th>
          </tr>
        </thead>
        <tbody>
          {brackets.map((b, i) => (
            <tr key={i} className="border-b border-[var(--psc-border)]/60">
              <td className="py-2 pr-3 font-mono text-[var(--psc-ink)]">{marginalBandLabel(brackets, i)}</td>
              <td className="py-2 font-mono tabular-nums text-[var(--psc-ink)]">
                {(Number(b.rate) * 100).toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function NationalMetricsPage() {
  const supabase = await tryCreateClient();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to load national metrics.
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: activeFy }, pres, isAdmin] = await Promise.all([
    supabase
      .from("rp_fiscal_years")
      .select("id, label, year_index, started_at, appropriation_deadline_at, appropriations_act_bill_id")
      .eq("status", "active")
      .maybeSingle(),
    isPresident(supabase, user.id),
    getIsAdmin(),
  ]);

  const fy = activeFy as {
    id: string;
    label: string;
    year_index: number;
    started_at: string;
    appropriation_deadline_at?: string | null;
    appropriations_act_bill_id?: string | null;
  } | null;

  const { data: currentNational } = fy?.id
    ? await supabase.from("national_metrics").select("*").eq("fiscal_year_id", fy.id).maybeSingle()
    : { data: null };

  const { data: fyHist } = await supabase
    .from("rp_fiscal_years")
    .select("id, year_index, label, status")
    .order("year_index", { ascending: false })
    .limit(8);

  const histIds = (fyHist ?? []).map((f) => f.id);
  const { data: nmHist } =
    histIds.length > 0
      ? await supabase.from("national_metrics").select("*").in("fiscal_year_id", histIds)
      : { data: [] };

  const metricsHistory: NationalMetricsHistoryRow[] = (fyHist ?? [])
    .map((row) => {
      const nm = (nmHist ?? []).find((n) => (n as { fiscal_year_id: string }).fiscal_year_id === row.id) as
        | NationalMetricsRow
        | undefined;
      if (!nm) return null;
      return {
        ...nm,
        year_label: row.label,
        year_index: row.year_index,
        fiscal_status: row.status,
      };
    })
    .filter(Boolean) as NationalMetricsHistoryRow[];

  const { data: budgetRow } = fy?.id
    ? await supabase
        .from("federal_budgets")
        .select("status, tax_brackets")
        .eq("fiscal_year_id", fy.id)
        .maybeSingle()
    : { data: null };

  const brackets = parseTaxBrackets((budgetRow as { tax_brackets?: unknown } | null)?.tax_brackets);
  const budgetStatus = String((budgetRow as { status?: string } | null)?.status ?? "");

  const appropriationsClock =
    fy?.appropriation_deadline_at && !fy?.appropriations_act_bill_id
      ? new Date(fy.appropriation_deadline_at) < new Date()
        ? "Shutdown: the annual appropriations act missed the statutory enrollment deadline; economy payouts stay suspended until a bill is enrolled and signed."
        : `Appropriations enrollment deadline (IRL): ${new Date(fy.appropriation_deadline_at).toLocaleString()}. Other federal legislation stays gated until the act is law.`
      : null;

  return (
    <div className="space-y-10">
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Nation</p>
            <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">National metrics &amp; federal tax</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--psc-muted)]">
              Simulator indicators for the active fiscal year, plus how federal income tax is structured for players. The
              government directory still links here from the Nation card at the top.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <NavRouteButton href="/directory">Directory</NavRouteButton>
            <NavRouteButton href="/economy">Economy</NavRouteButton>
            {pres || isAdmin ? <NavRouteButton href="/economy/federal">Federal budget</NavRouteButton> : null}
          </div>
        </div>
      </header>

      <section className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Federal income tax (public reference)</h2>
        <p className="text-sm text-[var(--psc-muted)]">
          Tax is assessed on <strong className="text-[var(--psc-ink)]">employment income</strong> for the fiscal year:
          scheduled government-role salary plus PAC hourly collects (ledger{" "}
          <code className="rounded bg-[color-mix(in_srgb,var(--psc-ink)_6%,transparent)] px-1 text-xs">hourly_income</code>
          ). Gifts, transfers, and other credits are excluded. Marginal bands apply to consecutive slices of income (same logic
          as the live budget and year-end close).
        </p>
        {fy ? (
          <p className="text-xs text-[var(--psc-muted)]">
            Active year: <span className="font-semibold text-[var(--psc-ink)]">{fy.label}</span> (FY index{" "}
            {fy.year_index}). Budget row status:{" "}
            <span className="font-mono font-semibold text-[var(--psc-ink)]">{budgetStatus || "—"}</span>. Brackets below come
            from that row (draft or submitted).
          </p>
        ) : (
          <p className="text-xs text-amber-900">No active fiscal year in the database.</p>
        )}
        {appropriationsClock ? (
          <p className="rounded border border-amber-600/50 bg-amber-50 px-3 py-2 text-xs text-amber-950">{appropriationsClock}</p>
        ) : null}
        <MarginalTaxBracketsTable brackets={brackets} />
        <p className="text-xs text-[var(--psc-muted)]">
          Party chairs may set a levy on the <strong className="text-[var(--psc-ink)]">salary slice only</strong> of hourly
          collects; it is withheld automatically when members collect (no separate party bill). That is separate from federal tax
          and is not shown here. Your personal YTD federal estimate appears on the Economy page when you are signed in.
        </p>
      </section>

      <NationalMetricsHub
        current={(currentNational as NationalMetricsRow | null) ?? null}
        history={metricsHistory}
        title="National metrics"
        description={
          <p>
            Indicators for the active fiscal year. Simulated national debt is kept at zero (not tied to player wallets). The
            appropriations editor remains on the federal budget page for the President and admins.
          </p>
        }
      />
    </div>
  );
}
