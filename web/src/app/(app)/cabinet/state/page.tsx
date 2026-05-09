import Link from "next/link";
import { redirect } from "next/navigation";
import { stateSpendDiplomaticHours } from "@/app/actions/cabinet-portfolios";
import { SubmitButton } from "@/components/submit-button";
import { canAccessStatePortfolio } from "@/lib/cabinet-hub";
import { cabinetWeekStartIso } from "@/lib/cabinet-week";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";

const cardClass =
  "rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm";

export default async function StateCabinetPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canAccessStatePortfolio(roleKeys)) redirect("/");

  const weekStart = cabinetWeekStartIso();
  const [{ data: nations, error: nErr }, { data: hoursRow, error: hErr }] = await Promise.all([
    supabase.from("rp_foreign_nations").select("code, name, us_relation").order("name", { ascending: true }),
    supabase
      .from("cabinet_weekly_hours")
      .select("hours_budget, hours_used")
      .eq("user_id", user.id)
      .eq("role_key", "secretary_of_state")
      .eq("week_start", weekStart)
      .maybeSingle(),
  ]);

  const hoursBudget = hoursRow ? Number((hoursRow as { hours_budget: number }).hours_budget) : 20;
  const hoursUsed = hoursRow ? Number((hoursRow as { hours_used: number }).hours_used) : 0;
  const hoursLeft = Math.max(0, hoursBudget - hoursUsed);

  const nationList = (nations ?? []) as Array<{ code: string; name: string; us_relation: number }>;
  const dataReady = !nErr && !hErr;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Cabinet</p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Secretary of State</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--psc-muted)]">
          You have a weekly diplomatic calendar budget. Spend hours on bilateral meetings to nudge U.S. standing with each
          partner (purely narrative flavor for the sim).
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
          Cabinet portfolio tables are not available yet. Apply the latest Supabase migration{" "}
          <code className="font-mono">20260513120000_cabinet_portfolio_dashboards.sql</code> and reload.
        </div>
      ) : null}

      <section className={cardClass}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">This week’s calendar</h2>
        <p className="mt-2 text-3xl font-mono font-bold text-[var(--psc-ink)]">{hoursLeft}</p>
        <p className="text-sm text-[var(--psc-muted)]">
          hours remaining of {hoursBudget} (week starting {weekStart}, UTC). Resets each Monday UTC.
        </p>
      </section>

      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Partner relationships</h2>
        <p className="mt-1 text-xs text-[var(--psc-muted)]">Scale −100 (hostile) to +100 (strong alignment).</p>
        <ul className="mt-4 space-y-4">
          {nationList.map((n) => {
            const pct = ((n.us_relation + 100) / 200) * 100;
            return (
              <li key={n.code} className="space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--psc-ink)]">
                    {n.name}{" "}
                    <span className="font-mono text-xs font-normal text-[var(--psc-muted)]">({n.code})</span>
                  </span>
                  <span className="font-mono text-sm text-[var(--psc-ink)]">{n.us_relation}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--psc-border)]">
                  <div
                    className="h-full rounded-full bg-[var(--psc-accent)] transition-[width]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Schedule a bilateral block</h2>
        <p className="mt-1 text-xs text-[var(--psc-muted)]">
          Larger blocks move the needle faster. Each 2 hours shifts the score by about 4 points (capped at the ends).
        </p>
        <form action={stateSpendDiplomaticHours} className="mt-4 space-y-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Nation
            <select
              name="nation_code"
              required
              className="mt-1 w-full rounded border border-[var(--psc-border)] bg-white px-3 py-2 text-sm text-[var(--psc-ink)]"
            >
              <option value="">Select…</option>
              {nationList.map((n) => (
                <option key={n.code} value={n.code}>
                  {n.name} ({n.code})
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Hours</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {([2, 4, 6, 8] as const).map((h) => (
                <label key={h} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name="hours" value={h} required defaultChecked={h === 4} />
                  {h}h
                </label>
              ))}
            </div>
          </fieldset>
          <SubmitButton
            disabled={hoursLeft < 2}
            className="inline-flex w-full items-center justify-center rounded-md border-2 border-[var(--psc-accent)] bg-[color-mix(in_srgb,var(--psc-accent)_12%,white)] px-3 py-2 text-sm font-bold text-[var(--psc-ink)]"
          >
            Commit time and meet
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}
