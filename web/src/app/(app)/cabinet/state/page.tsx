import Link from "next/link";
import { redirect } from "next/navigation";
import { StateDiplomacyWorkbench } from "@/components/state-diplomacy-workbench";
import { canActAsSecretaryOfState, canViewStateDepartment } from "@/lib/cabinet-hub";
import { cabinetDayStartIso } from "@/lib/cabinet-week";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";

export default async function StateCabinetPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canViewStateDepartment(roleKeys)) redirect("/");

  const canAct = canActAsSecretaryOfState(roleKeys);
  const dayUtc = cabinetDayStartIso();

  const { error: tickErr } = await supabase.rpc("rp_diplomacy_daily_tick", { p_today: dayUtc });
  if (tickErr && !tickErr.message.toLowerCase().includes("schema cache")) {
    console.warn("[cabinet/state] rp_diplomacy_daily_tick:", tickErr.message);
  }

  const [{ data: nations, error: nErr }, { data: hoursRow, error: hErr }] = await Promise.all([
    supabase.from("rp_foreign_nations").select("code, name, us_relation").order("name", { ascending: true }),
    supabase
      .from("cabinet_daily_hours")
      .select("hours_budget, hours_used")
      .eq("user_id", user.id)
      .eq("role_key", "secretary_of_state")
      .eq("day_utc", dayUtc)
      .maybeSingle(),
  ]);

  const hoursBudget = hoursRow ? Number((hoursRow as { hours_budget: number }).hours_budget) : 20;
  const hoursUsed = hoursRow ? Number((hoursRow as { hours_used: number }).hours_used) : 0;

  const nationList = (nations ?? []) as Array<{ code: string; name: string; us_relation: number }>;
  const dataReady = !nErr && !hErr;
  const mockCrisisWarning = process.env.NEXT_PUBLIC_DIPLOMACY_CRISIS_WARNING_MOCK === "1";

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Cabinet</p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Secretary of State</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--psc-muted)]">
          Bilateral standing is tracked on a 0–100 scale and drifts downward each UTC day unless the Secretary invests daily
          engagement hours. Passive desk time is steady; intensive dialogues cost more hours but can recover ground faster
          and are logged for staff-led RP events.
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
          Cabinet diplomacy tables are not available yet. Apply the latest Supabase migration{" "}
          <code className="font-mono">20260515120000_cabinet_daily_hours_diplomacy.sql</code> and reload.
        </div>
      ) : (
        <StateDiplomacyWorkbench
          nations={nationList}
          hoursBudget={hoursBudget}
          hoursUsed={hoursUsed}
          canAct={canAct}
          mockCrisisWarning={mockCrisisWarning}
        />
      )}
    </div>
  );
}
