import Link from "next/link";
import { redirect } from "next/navigation";
import { defenseSpendHours } from "@/app/actions/cabinet-portfolios";
import { DiplomacyRiskHeatmap } from "@/components/diplomacy-risk-heatmap";
import { SubmitButton } from "@/components/submit-button";
import { canActAsSecretaryOfDefense, canViewDefenseDepartment } from "@/lib/cabinet-hub";
import { cabinetDayStartIso } from "@/lib/cabinet-week";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";

const cardClass =
  "rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm";

type DefenseBody = {
  readiness?: number;
  logistics_stress?: number;
  alliance_exercises_completed?: number;
};

export default async function DefenseCabinetPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canViewDefenseDepartment(roleKeys)) redirect("/");

  const canAct = canActAsSecretaryOfDefense(roleKeys);
  const dayUtc = cabinetDayStartIso();
  const [{ data: metrics, error: mErr }, { data: hoursRow, error: hErr }, { data: nations, error: dipErr }] =
    await Promise.all([
      supabase.from("rp_cabinet_department_metrics").select("body").eq("portfolio_key", "defense").maybeSingle(),
      supabase
        .from("cabinet_daily_hours")
        .select("hours_budget, hours_used")
        .eq("user_id", user.id)
        .eq("role_key", "secretary_of_defense")
        .eq("day_utc", dayUtc)
        .maybeSingle(),
      supabase.from("rp_foreign_nations").select("code, name, us_relation").order("name", { ascending: true }),
    ]);

  const body = ((metrics as { body?: DefenseBody } | null)?.body ?? {}) as DefenseBody;
  const readiness = Number(body.readiness ?? 0);
  const logistics = Number(body.logistics_stress ?? 0);
  const exercises = Number(body.alliance_exercises_completed ?? 0);

  const hoursBudget = hoursRow ? Number((hoursRow as { hours_budget: number }).hours_budget) : 20;
  const hoursUsed = hoursRow ? Number((hoursRow as { hours_used: number }).hours_used) : 0;
  const hoursLeft = Math.max(0, hoursBudget - hoursUsed);
  const nationList = (nations ?? []) as Array<{ code: string; name: string; us_relation: number }>;
  const dataReady = !mErr && !hErr && !dipErr;

  const actions = [
    { key: "field_exercise", label: "Alliance field exercise", hours: 5, blurb: "+readiness, +logistics stress" },
    { key: "acquisition_review", label: "Acquisition & sustainment review", hours: 4, blurb: "+readiness a bit, −logistics stress" },
    { key: "personnel_surge", label: "Personnel readiness surge", hours: 6, blurb: "+readiness, −logistics stress" },
  ] as const;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Cabinet</p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Secretary of Defense</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--psc-muted)]">
          Steer attention across readiness, logistics, and exercises. Costs are in daily engagement hours (UTC) — numbers
          are illustrative for RP threads.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/cabinet"
            className="inline-block text-sm font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline"
          >
            ← Cabinet overview
          </Link>
          <Link
            href="/cabinet/nsc"
            className="inline-block text-sm font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline"
          >
            Situation Room briefing →
          </Link>
        </div>
      </header>

      {!dataReady ? (
        <div className="rounded border border-amber-600 bg-amber-50 p-4 text-sm text-amber-950">
          Defense dashboard data not found. Apply migrations through{" "}
          <code className="font-mono">20260515120000_cabinet_daily_hours_diplomacy.sql</code>.
        </div>
      ) : null}

      {nationList.length > 0 ? (
        <section className={cardClass}>
          <DiplomacyRiskHeatmap nations={nationList} variant="compact" />
          <p className="mt-3 text-xs text-[var(--psc-muted)]">
            Shared with the{" "}
            <Link href="/cabinet/nsc" className="font-semibold text-[var(--psc-accent)] underline-offset-2 hover:underline">
              Situation Room briefing
            </Link>{" "}
            so principals see the same heat map alongside readiness.
          </p>
        </section>
      ) : null}

      <section className={cardClass}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Engagement hours</h2>
        <p className="mt-2 text-3xl font-mono font-bold text-[var(--psc-ink)]">{hoursLeft}</p>
        <p className="text-sm text-[var(--psc-muted)]">
          of {hoursBudget} left today ({dayUtc} UTC).
        </p>
      </section>

      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Posture snapshot</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Readiness</dt>
            <dd className="font-mono text-2xl text-[var(--psc-ink)]">{readiness}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Logistics stress</dt>
            <dd className="font-mono text-2xl text-[var(--psc-ink)]">{logistics}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Exercises done</dt>
            <dd className="font-mono text-2xl text-[var(--psc-ink)]">{exercises}</dd>
          </div>
        </dl>
      </section>

      {canAct ? (
        <section className={cardClass}>
          <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Prioritize today</h2>
          <ul className="mt-4 space-y-3">
            {actions.map((a) => (
              <li key={a.key}>
                <form
                  action={defenseSpendHours}
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
      ) : (
        <p className="rounded-lg border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-4 text-sm text-[var(--psc-muted)]">
          Only the Secretary of Defense may commit engagement hours. Other principals and cabinet members can read the
          posture snapshot for RP context.
        </p>
      )}
    </div>
  );
}
