import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaffMayAccessElectionsConsole } from "@/lib/staff-access";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { getServerAuth } from "@/lib/supabase/server";
import {
  computeSimulationRpInstant,
  formatRpCalendarShort,
  type SimulationSettingsRow,
} from "@/lib/simulation-calendar";
import { resolveSimulationSettingsForWidget } from "@/lib/simulation-widget-data";
import { OrientationTourPanelElections } from "@/components/orientation-tour-panel";
import { RpDatePill } from "@/components/rp-date-pill";
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
      .select("home_district_code, residence_state, orientation_completed_at, orientation_step")
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
  /** Chamber-wide leadership (Speaker, SML, etc.) lives under Congress, not this page. */
  const active = all.filter((e) => {
    if (e.leadership_role) return false;
    if (e.phase === "closed") return false;
    if (
      e.phase === "filing" &&
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

  const prof = profile as {
    home_district_code?: string | null;
    residence_state?: string | null;
    orientation_completed_at?: string | null;
    orientation_step?: number | null;
  } | null;
  const inTour = !prof?.orientation_completed_at;
  const onStep1 = inTour && (prof?.orientation_step ?? 1) === 1;
  // Candidacy must match any non-closed seat/president race — not leadership (Congress page).
  const nonClosedIds = all
    .filter((e) => e.phase !== "closed" && !e.leadership_role)
    .map((e) => e.id);
  let electionsTourCanAdvance = nonClosedIds.length === 0;
  if (onStep1 && !electionsTourCanAdvance) {
    const { data: myCand } = await supabase
      .from("election_candidates")
      .select("id")
      .eq("user_id", user.id)
      .in("election_id", nonClosedIds)
      .limit(1)
      .maybeSingle();
    electionsTourCanAdvance = Boolean(myCand);
  }
  const orientationElectionBlock = onStep1 ? (
    <OrientationTourPanelElections canAdvance={electionsTourCanAdvance} />
  ) : null;

  const rpNow = simSettingsForDisplay
    ? computeSimulationRpInstant(simSettingsForDisplay, new Date())
    : null;
  const rpDateLabel = rpNow ? formatRpCalendarShort(rpNow) : null;

  if (!all.length) {
    return (
      <div className="space-y-8">
        {orientationElectionBlock}
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Elections</h1>
          {rpDateLabel ? <RpDatePill label={rpDateLabel} /> : null}
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
        {orientationElectionBlock}
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Elections</h1>
            <p className="mt-1 max-w-3xl text-sm text-[var(--psc-muted)]">
              No active races right now.
            </p>
          </div>
          {rpDateLabel ? <RpDatePill label={rpDateLabel} /> : null}
        </header>
        <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <p className="text-sm text-[var(--psc-muted)]">
            Chamber leadership races (Speaker, Senate Majority Leader, etc.) are listed on{" "}
            <Link href="/congress" className="font-semibold text-[var(--psc-accent)] underline">
              Congress
            </Link>
            .
          </p>
          <p className="mt-3 text-sm text-[var(--psc-muted)]">
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
      {orientationElectionBlock}
      <ElectionsDashboard
        elections={dashboardRows}
        userDistrict={profile?.home_district_code ?? null}
        userState={profile?.residence_state ?? null}
        rpDateLabel={rpDateLabel}
      />
    </div>
  );
}
