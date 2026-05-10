import Link from "next/link";
import { redirect } from "next/navigation";
import { courtDocketTick } from "@/app/actions/attorney-general";
import {
  AttorneyGeneralCourtWorkbench,
  type CourtCaseRow,
} from "@/components/attorney-general-court-workbench";
import { canActAsAttorneyGeneral, canViewJusticeDepartment } from "@/lib/cabinet-hub";
import { cabinetDayStartIso } from "@/lib/cabinet-week";
import { isCourtAgenda } from "@/lib/court-case-agenda";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";

const cardClass =
  "rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm";

type JusticeBody = {
  active_investigations?: number;
  civil_rights_queue?: number;
  public_confidence?: number;
};

export default async function JusticeCabinetPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canViewJusticeDepartment(roleKeys)) redirect("/");

  const isAttorneyGeneral = canActAsAttorneyGeneral(roleKeys);
  const isPresident = roleKeys.includes("president") || roleKeys.includes("admin") || roleKeys.includes("staff_super");
  const dayUtc = cabinetDayStartIso();

  // Run docket tick (expire stale + maybe open new). Swallow schema-cache errors so the page
  // renders before the migration is applied.
  try {
    await courtDocketTick();
  } catch (e) {
    if (!(e instanceof Error) || !e.message.toLowerCase().includes("schema cache")) {
      console.warn("[cabinet/justice] courtDocketTick:", e);
    }
  }

  const [{ data: metrics, error: mErr }, { data: hoursRow, error: hErr }, { data: casesRows, error: cErr }] =
    await Promise.all([
      supabase.from("rp_cabinet_department_metrics").select("body").eq("portfolio_key", "justice").maybeSingle(),
      supabase
        .from("cabinet_daily_hours")
        .select("hours_budget, hours_used")
        .eq("user_id", user.id)
        .eq("role_key", "attorney_general")
        .eq("day_utc", dayUtc)
        .maybeSingle(),
      supabase
        .from("rp_court_cases")
        .select(
          "id, case_label, topic, fact_pattern, question_presented, status, side_taken, outcome_tier, outcome_summary, presidential_directive, target_bill_id, agenda, opens_at, closes_at",
        )
        .order("opens_at", { ascending: false })
        .limit(20),
    ]);

  const body = ((metrics as { body?: JusticeBody } | null)?.body ?? {}) as JusticeBody;
  const inv = Number(body.active_investigations ?? 0);
  const civil = Number(body.civil_rights_queue ?? 0);
  const confidence = Number(body.public_confidence ?? 0);

  const hoursBudget = hoursRow ? Number((hoursRow as { hours_budget: number }).hours_budget) : 20;
  const hoursUsed = hoursRow ? Number((hoursRow as { hours_used: number }).hours_used) : 0;

  const dataReady = !mErr && !hErr && !cErr;

  type RawCase = {
    id: string;
    case_label: string;
    topic: string;
    fact_pattern: string;
    question_presented: string;
    status: string;
    side_taken: string | null;
    outcome_tier: string | null;
    outcome_summary: string | null;
    presidential_directive: "defend" | "challenge" | null;
    target_bill_id: string | null;
    agenda: unknown;
    opens_at: string;
    closes_at: string;
  };
  const cases: CourtCaseRow[] = ((casesRows ?? []) as RawCase[]).map((r) => ({
    id: r.id,
    caseLabel: r.case_label,
    topic: r.topic,
    factPattern: r.fact_pattern,
    questionPresented: r.question_presented,
    status: r.status,
    sideTaken: r.side_taken,
    outcomeTier: r.outcome_tier,
    outcomeSummary: r.outcome_summary,
    presidentialDirective: r.presidential_directive,
    targetBillId: r.target_bill_id,
    agenda: isCourtAgenda(r.agenda) ? r.agenda : null,
    openedAt: r.opens_at,
    closesAt: r.closes_at,
  }));

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Cabinet</p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Attorney General</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--psc-muted)]">
          The Department of Justice argues every case the United States is a party to. New cases enter the docket
          automatically; the Attorney General must enter an appearance — argue the merits, file an amicus brief, or
          decline to defend — within five days. The President may issue an advisory directive on any open case.
        </p>
        <Link
          href="/cabinet"
          className="inline-block text-sm font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline"
        >
          ← Cabinet overview
        </Link>
      </header>

      {!dataReady ? (
        <div className="rounded border border-amber-600 bg-amber-50 p-4 text-sm text-amber-950">
          Justice dashboard data not found. Apply migration{" "}
          <code className="font-mono">20260517120000_attorney_general_court_docket.sql</code>.
        </div>
      ) : null}

      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Department snapshot</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Major investigations</dt>
            <dd className="font-mono text-2xl text-[var(--psc-ink)]">{inv}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Civil-rights queue</dt>
            <dd className="font-mono text-2xl text-[var(--psc-ink)]">{civil}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Public confidence</dt>
            <dd className="font-mono text-2xl text-[var(--psc-ink)]">{confidence}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-[var(--psc-muted)]">
          Public confidence rises and falls with court rulings; missed deadlines and overrides of presidential
          directives carry penalties.
        </p>
      </section>

      <AttorneyGeneralCourtWorkbench
        cases={cases}
        hoursBudget={hoursBudget}
        hoursUsed={hoursUsed}
        isAttorneyGeneral={isAttorneyGeneral}
        isPresident={isPresident}
      />

      {!isAttorneyGeneral && !isPresident ? (
        <p className="rounded-lg border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-4 text-sm text-[var(--psc-muted)]">
          Only the Attorney General may take docket actions; only the President may issue directives. Other principals
          can read the docket for RP context.
        </p>
      ) : null}
    </div>
  );
}
