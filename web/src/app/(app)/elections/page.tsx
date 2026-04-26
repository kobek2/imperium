import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaffMayAccessElectionsConsole } from "@/lib/staff-access";
import { SimulationRpBanner } from "@/components/simulation-rp-banner";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { getServerAuth } from "@/lib/supabase/server";
import { computeSimulationRpInstant, type SimulationSettingsRow } from "@/lib/simulation-calendar";
import { resolveSimulationSettingsForWidget } from "@/lib/simulation-widget-data";
import {
  ElectionsDashboard,
  type DashboardElection,
} from "./elections-dashboard";

export default async function ElectionsPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to load election data.
      </div>
    );
  }

  if (!user) redirect("/login");

  const isAdmin = await getStaffMayAccessElectionsConsole();

  await runElectionPhaseSchedule(supabase);

  const [{ data: elections }, { data: profile }, simSettingsRes] = await Promise.all([
    supabase
      .from("elections")
      .select(
        "id, office, phase, filing_opens_at, filing_closes_at, primary_closes_at, general_closes_at, district_code, state, senate_class, leadership_role, restricted_party, filing_window_started_at",
      )
      .order("filing_opens_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("home_district_code, residence_state")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("simulation_settings").select("*").eq("id", 1).maybeSingle(),
  ]);

  const simSettingsRaw =
    simSettingsRes.error || !simSettingsRes.data
      ? null
      : (simSettingsRes.data as SimulationSettingsRow);
  const simSettingsForDisplay = simSettingsRaw
    ? await resolveSimulationSettingsForWidget(supabase, simSettingsRaw, isAdmin)
    : null;

  const all = (elections ?? []) as Array<
    Omit<DashboardElection, "candidate_count">
  >;
  const active = all.filter((e) => {
    if (e.phase === "closed") return false;
    if (
      e.phase === "filing" &&
      !e.leadership_role &&
      !(e as { filing_window_started_at?: string | null }).filing_window_started_at
    ) {
      return false;
    }
    return true;
  });
  // Fetch candidate counts for active races in one query.
  const activeIds = active.map((e) => e.id);
  const countsById: Record<string, number> = {};
  if (activeIds.length) {
    const phaseById = new Map(active.map((e) => [e.id, e.phase]));
    const { data: candRows } = await supabase
      .from("election_candidates")
      .select("election_id, primary_winner")
      .in("election_id", activeIds);

    const allById: Record<string, number> = {};
    const winnersById: Record<string, number> = {};
    for (const row of (candRows ?? []) as Array<{ election_id: string; primary_winner: boolean | null }>) {
      const id = row.election_id;
      allById[id] = (allById[id] ?? 0) + 1;
      if (row.primary_winner) {
        winnersById[id] = (winnersById[id] ?? 0) + 1;
      }
    }

    for (const id of activeIds) {
      const phase = phaseById.get(id);
      const winnerCount = winnersById[id] ?? 0;
      const allCount = allById[id] ?? 0;
      countsById[id] =
        (phase === "general" || phase === "closed") && winnerCount > 0 ? winnerCount : allCount;
    }
  }

  const dashboardRows: DashboardElection[] = active.map((e) => ({
    ...e,
    candidate_count: countsById[e.id] ?? 0,
  }));

  const rpNow = simSettingsForDisplay
    ? computeSimulationRpInstant(simSettingsForDisplay, new Date())
    : null;
  const rpBanner =
    rpNow && simSettingsForDisplay ? (
      <SimulationRpBanner settings={simSettingsForDisplay} rp={rpNow} />
    ) : null;

  if (!all.length) {
    return (
      <div className="space-y-8">
        {rpBanner}
        <header>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Elections</h1>
        </header>
        <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <p className="text-sm text-[var(--psc-muted)]">
            No races scheduled yet. Admins can create elections under{" "}
            <Link
              href="/admin/elections"
              className="font-semibold text-[var(--psc-accent)] underline"
            >
              Admin → Elections
            </Link>
            .
          </p>
        </section>
      </div>
    );
  }

  if (!active.length) {
    return (
      <div className="space-y-8">
        {rpBanner}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Elections</h1>
            <p className="mt-1 max-w-3xl text-sm text-[var(--psc-muted)]">
              No active races right now.
            </p>
          </div>
        </header>
        <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <p className="text-sm text-[var(--psc-muted)]">
            {isAdmin ? (
              <>
                Past results are under{" "}
                <Link
                  href="/admin/elections?tab=archive"
                  className="font-semibold text-[var(--psc-accent)] underline"
                >
                  Admin → Elections → Archive
                </Link>
                .
              </>
            ) : (
              <>Check back when the next filing window opens.</>
            )}
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {rpBanner}
      <ElectionsDashboard
        elections={dashboardRows}
        userDistrict={profile?.home_district_code ?? null}
        userState={profile?.residence_state ?? null}
      />
    </div>
  );
}
