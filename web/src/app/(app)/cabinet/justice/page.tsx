import Link from "next/link";
import { redirect } from "next/navigation";
import { justiceSpendHours } from "@/app/actions/cabinet-portfolios";
import { SubmitButton } from "@/components/submit-button";
import { canAccessJusticePortfolio } from "@/lib/cabinet-hub";
import { cabinetWeekStartIso } from "@/lib/cabinet-week";
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
  if (!canAccessJusticePortfolio(roleKeys)) redirect("/");

  const weekStart = cabinetWeekStartIso();
  const [{ data: metrics, error: mErr }, { data: hoursRow, error: hErr }] = await Promise.all([
    supabase.from("rp_cabinet_department_metrics").select("body").eq("portfolio_key", "justice").maybeSingle(),
    supabase
      .from("cabinet_weekly_hours")
      .select("hours_budget, hours_used")
      .eq("user_id", user.id)
      .eq("role_key", "attorney_general")
      .eq("week_start", weekStart)
      .maybeSingle(),
  ]);

  const body = ((metrics as { body?: JusticeBody } | null)?.body ?? {}) as JusticeBody;
  const inv = Number(body.active_investigations ?? 0);
  const civil = Number(body.civil_rights_queue ?? 0);
  const confidence = Number(body.public_confidence ?? 0);

  const hoursBudget = hoursRow ? Number((hoursRow as { hours_budget: number }).hours_budget) : 20;
  const hoursUsed = hoursRow ? Number((hoursRow as { hours_used: number }).hours_used) : 0;
  const hoursLeft = Math.max(0, hoursBudget - hoursUsed);
  const dataReady = !mErr && !hErr;

  const actions = [
    {
      key: "prosecutorial_triage",
      label: "Prosecutorial triage week",
      hours: 4,
      blurb: "Clear investigations, modest confidence bump.",
    },
    {
      key: "civil_rights_surge",
      label: "Civil-rights strike team",
      hours: 5,
      blurb: "Burn down civil-rights complaints backlog.",
    },
    {
      key: "public_briefing",
      label: "Public briefing tour",
      hours: 3,
      blurb: "Transparency push — confidence up, doesn’t touch caseload.",
    },
  ] as const;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Cabinet</p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Attorney General</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--psc-muted)]">
          Allocate DOJ attention across investigations, civil rights, and public trust. Weekly hours cap how much you can
          steer in a single RP week.
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
          <code className="font-mono">20260513120000_cabinet_portfolio_dashboards.sql</code>.
        </div>
      ) : null}

      <section className={cardClass}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Engagement hours</h2>
        <p className="mt-2 text-3xl font-mono font-bold text-[var(--psc-ink)]">{hoursLeft}</p>
        <p className="text-sm text-[var(--psc-muted)]">
          of {hoursBudget} left this week (starts {weekStart} UTC).
        </p>
      </section>

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
      </section>

      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Direct priorities</h2>
        <ul className="mt-4 space-y-3">
          {actions.map((a) => (
            <li key={a.key}>
              <form
                action={justiceSpendHours}
                className="flex flex-col gap-2 rounded border border-[var(--psc-border)] bg-white/40 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <input type="hidden" name="action" value={a.key} />
                <div>
                  <p className="font-semibold text-[var(--psc-ink)]">{a.label}</p>
                  <p className="text-xs text-[var(--psc-muted)]">{a.blurb}</p>
                  <p className="mt-1 font-mono text-xs text-[var(--psc-muted)]">{a.hours}h</p>
                </div>
                <SubmitButton
                  disabled={hoursLeft < a.hours}
                  className="shrink-0 rounded-md border-2 border-[var(--psc-accent)] bg-[color-mix(in_srgb,var(--psc-accent)_12%,white)] px-3 py-2 text-sm font-bold text-[var(--psc-ink)]"
                >
                  Execute
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
