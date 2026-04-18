import Link from "next/link";
import { redirect } from "next/navigation";
import { OpenOccupiedSeatFilingsForm } from "@/components/open-occupied-seat-filings-form";
import { SimulationRpBanner } from "@/components/simulation-rp-banner";
import { SimulationSettingsForm } from "@/components/simulation-settings-form";
import { runJanuaryAutoOpenIfEligible } from "@/app/actions/simulation";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { tryCreateClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";
import { computeSimulationRpInstant, type SimulationSettingsRow } from "@/lib/simulation-calendar";
import { resolveSimulationSettingsForWidget } from "@/lib/simulation-widget-data";
import {
  AdminElectionsList,
  type AdminElectionRow,
} from "./admin-elections-list";
import {
  LeadershipToggle,
  type LeadershipSessionRow,
} from "./leadership-toggle";
import { BulkEndElectionsForm } from "./bulk-end-elections-form";

export default async function AdminElectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  if (!(await getIsAdmin())) redirect("/");

  const { tab } = await searchParams;
  const electionView: "active" | "archive" = tab === "archive" ? "archive" : "active";

  const supabase = await tryCreateClient();
  if (!supabase) redirect("/");

  await runElectionPhaseSchedule(supabase);
  await runJanuaryAutoOpenIfEligible();

  const [{ data: rows }, sessionsRes, simSettingsRes] = await Promise.all([
    supabase
      .from("elections")
      .select(
        "id, office, state, district_code, senate_class, phase, filing_opens_at, filing_closes_at, primary_closes_at, general_closes_at, leadership_role, restricted_party, filing_window_started_at",
      )
      .order("filing_opens_at", { ascending: false }),
    supabase
      .from("leadership_sessions")
      .select("id, chamber, phase, majority_party, opens_at, closes_at, closed_at")
      .eq("phase", "open"),
    supabase.from("simulation_settings").select("*").eq("id", 1).maybeSingle(),
  ]);

  const { data: sessions, error: sessionsErr } = sessionsRes;
  const leadershipSchemaMissing =
    !!sessionsErr &&
    (sessionsErr.message.toLowerCase().includes("leadership_sessions") ||
      sessionsErr.code === "PGRST205");

  const list = (rows ?? []) as Array<Omit<AdminElectionRow, "candidate_count">>;

  const countsById: Record<string, number> = {};
  if (list.length) {
    const { data: candRows } = await supabase
      .from("election_candidates")
      .select("election_id")
      .in(
        "election_id",
        list.map((r) => r.id),
      );
    for (const row of candRows ?? []) {
      const id = row.election_id as string;
      countsById[id] = (countsById[id] ?? 0) + 1;
    }
  }

  const dashboardRows: AdminElectionRow[] = list.map((r) => ({
    ...r,
    candidate_count: countsById[r.id] ?? 0,
  }));

  const closedCount = dashboardRows.filter((r) => r.phase === "closed").length;

  const sessionRows = (sessions ?? []) as LeadershipSessionRow[];
  const houseSession = sessionRows.find((s) => s.chamber === "house") ?? null;
  const senateSession = sessionRows.find((s) => s.chamber === "senate") ?? null;

  const simSettings =
    simSettingsRes.error || !simSettingsRes.data
      ? null
      : (simSettingsRes.data as SimulationSettingsRow);
  const simSettingsForBanner = simSettings
    ? await resolveSimulationSettingsForWidget(supabase, simSettings, true)
    : null;
  const { data: simSettingsRefetched } = simSettings
    ? await supabase.from("simulation_settings").select("*").eq("id", 1).maybeSingle()
    : { data: null };
  const simSettingsForForm =
    !simSettingsRefetched || simSettingsRes.error
      ? simSettings
      : (simSettingsRefetched as SimulationSettingsRow);
  const rpNow = simSettingsForBanner
    ? computeSimulationRpInstant(simSettingsForBanner, new Date())
    : null;

  return (
    <div className="space-y-6">
      {rpNow && simSettingsForBanner ? (
        <SimulationRpBanner settings={simSettingsForBanner} rp={rpNow} />
      ) : null}
      {simSettingsForForm ? <SimulationSettingsForm initial={simSettingsForForm} /> : null}
      <OpenOccupiedSeatFilingsForm />
      <LeadershipToggle
        houseSession={houseSession}
        senateSession={senateSession}
        schemaMissing={leadershipSchemaMissing}
      />
      <BulkEndElectionsForm />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--psc-border)] pb-3">
          <Link
            href="/admin/elections"
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition ${
              electionView === "active"
                ? "border-[var(--psc-ink)] bg-[var(--psc-ink)] text-white"
                : "border-[var(--psc-border)] bg-[var(--psc-panel)] text-[var(--psc-ink)] hover:border-[var(--psc-accent)]"
            }`}
          >
            Active races
          </Link>
          <Link
            href="/admin/elections?tab=archive"
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition ${
              electionView === "archive"
                ? "border-[var(--psc-ink)] bg-[var(--psc-ink)] text-white"
                : "border-[var(--psc-border)] bg-[var(--psc-panel)] text-[var(--psc-ink)] hover:border-[var(--psc-accent)]"
            }`}
          >
            Archive
            <span
              className={`rounded-full px-1.5 font-mono text-xs ${
                electionView === "archive" ? "bg-white/20" : "bg-[var(--psc-canvas)] text-[var(--psc-muted)]"
              }`}
            >
              {closedCount}
            </span>
          </Link>
        </div>
        <AdminElectionsList key={electionView} rows={dashboardRows} view={electionView} />
      </div>
    </div>
  );
}
