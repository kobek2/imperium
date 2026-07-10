import nextDynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCityFiscalSnapshot } from "@/lib/city-fiscal-data";
import { ensureCityMetricsCaughtUp } from "@/lib/city-metrics-data";
import { loadCityOfficeData } from "@/lib/city-office-data";
import { getIsAdmin } from "@/lib/is-admin";
import { loadCityOfficeSalaryAccrual } from "@/lib/city-office-salary-accrual";
import { loadCitySimWeekStatus } from "@/lib/city-sim-week-data";
import { ensureCityElectionSeatingForUser } from "@/lib/city-election-seating";

/** Refresh after mayor signs so Policies tab reflects enacted ordinances. */
export const dynamic = "force-dynamic";

const CouncilPageShell = nextDynamic(
  () => import("@/components/council-page-shell").then((m) => m.CouncilPageShell),
  {
    loading: () => (
      <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-10 text-center text-sm text-[var(--psc-muted)]">
        Loading council dashboard…
      </div>
    ),
  },
);

export default async function CouncilPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/welcome");

  await ensureCityElectionSeatingForUser(supabase, user.id);

  const fiscal = await loadCityFiscalSnapshot(supabase);
  const [data, metrics, isAdmin, officeSalaryAccrual, simWeek] = await Promise.all([
    loadCityOfficeData(supabase, user.id),
    ensureCityMetricsCaughtUp(supabase, undefined, fiscal),
    getIsAdmin(),
    loadCityOfficeSalaryAccrual(supabase, user.id),
    loadCitySimWeekStatus(supabase),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">City Council</h1>
        <p className="max-w-2xl text-sm text-[var(--psc-muted)]">
          Seven borough-based districts, budget votes, and local ordinances. NPC seats follow party lines on
          budget (mayor&apos;s party) and ordinances (stance spectrum).
        </p>
      </header>
      <CouncilPageShell
        data={data}
        fiscal={fiscal}
        metrics={metrics}
        simWeek={simWeek}
        isAdmin={isAdmin}
        officeSalaryAccrual={officeSalaryAccrual}
      />
    </div>
  );
}
