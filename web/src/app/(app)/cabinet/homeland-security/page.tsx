import Link from "next/link";
import { redirect } from "next/navigation";
import { homelandSpendHours } from "@/app/actions/cabinet-portfolios";
import { SubmitButton } from "@/components/submit-button";
import { canAccessHomelandPortfolio } from "@/lib/cabinet-hub";
import { cabinetWeekStartIso } from "@/lib/cabinet-week";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";

const cardClass =
  "rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm";

type HomelandBody = {
  threat_index?: number;
  border_caseload?: number;
  cyber_open_alerts?: number;
};

export default async function HomelandCabinetPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canAccessHomelandPortfolio(roleKeys)) redirect("/");

  const weekStart = cabinetWeekStartIso();
  const [{ data: metrics, error: mErr }, { data: hoursRow, error: hErr }] = await Promise.all([
    supabase.from("rp_cabinet_department_metrics").select("body").eq("portfolio_key", "homeland").maybeSingle(),
    supabase
      .from("cabinet_weekly_hours")
      .select("hours_budget, hours_used")
      .eq("user_id", user.id)
      .eq("role_key", "secretary_of_homeland_security")
      .eq("week_start", weekStart)
      .maybeSingle(),
  ]);

  const body = ((metrics as { body?: HomelandBody } | null)?.body ?? {}) as HomelandBody;
  const threat = Number(body.threat_index ?? 0);
  const border = Number(body.border_caseload ?? 0);
  const cyber = Number(body.cyber_open_alerts ?? 0);

  const hoursBudget = hoursRow ? Number((hoursRow as { hours_budget: number }).hours_budget) : 20;
  const hoursUsed = hoursRow ? Number((hoursRow as { hours_used: number }).hours_used) : 0;
  const hoursLeft = Math.max(0, hoursBudget - hoursUsed);
  const dataReady = !mErr && !hErr;

  const actions = [
    {
      key: "national_coordination",
      label: "National coordination cell",
      hours: 4,
      blurb: "Lower composite threat, trim border caseload.",
    },
    { key: "cyber_sprint", label: "Cyber response sprint", hours: 5, blurb: "Close alerts, slight threat relief." },
    {
      key: "border_surge",
      label: "Border surge operations",
      hours: 6,
      blurb: "Big caseload cut; threat ticks up from visibility.",
    },
  ] as const;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Cabinet</p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Secretary of Homeland Security</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--psc-muted)]">
          Balance prevention, response, and political optics. Spend weekly hours to steer taskings — metrics are RP
          scaffolding, not combat sims.
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
          Homeland dashboard data not found. Apply migration{" "}
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
        <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Operating picture</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Threat index</dt>
            <dd className="font-mono text-2xl text-[var(--psc-ink)]">{threat}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Border caseload</dt>
            <dd className="font-mono text-2xl text-[var(--psc-ink)]">{border}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Cyber alerts</dt>
            <dd className="font-mono text-2xl text-[var(--psc-ink)]">{cyber}</dd>
          </div>
        </dl>
      </section>

      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Taskings</h2>
        <ul className="mt-4 space-y-3">
          {actions.map((a) => (
            <li key={a.key}>
              <form
                action={homelandSpendHours}
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
