import { redirect } from "next/navigation";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { tryCreateClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";
import {
  AdminElectionsList,
  type AdminElectionRow,
} from "./admin-elections-list";
import {
  LeadershipToggle,
  type LeadershipSessionRow,
} from "./leadership-toggle";

export default async function AdminElectionsPage() {
  if (!(await getIsAdmin())) redirect("/");

  const supabase = await tryCreateClient();
  if (!supabase) redirect("/");

  await runElectionPhaseSchedule(supabase);

  const [{ data: rows }, sessionsRes] = await Promise.all([
    supabase
      .from("elections")
      .select(
        "id, office, state, district_code, senate_class, phase, filing_opens_at, filing_closes_at, primary_closes_at, general_closes_at, leadership_role, restricted_party",
      )
      .order("filing_opens_at", { ascending: false }),
    supabase
      .from("leadership_sessions")
      .select("id, chamber, phase, majority_party, opens_at, closes_at, closed_at")
      .eq("phase", "open"),
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

  const sessionRows = (sessions ?? []) as LeadershipSessionRow[];
  const houseSession = sessionRows.find((s) => s.chamber === "house") ?? null;
  const senateSession = sessionRows.find((s) => s.chamber === "senate") ?? null;

  return (
    <div className="space-y-6">
      <LeadershipToggle
        houseSession={houseSession}
        senateSession={senateSession}
        schemaMissing={leadershipSchemaMissing}
      />
      <AdminElectionsList rows={dashboardRows} />
    </div>
  );
}
