import { redirect } from "next/navigation";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { tryCreateClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";
import {
  AdminElectionsList,
  type AdminElectionRow,
} from "./admin-elections-list";

export default async function AdminElectionsPage() {
  if (!(await getIsAdmin())) redirect("/");

  const supabase = await tryCreateClient();
  if (!supabase) redirect("/");

  await runElectionPhaseSchedule(supabase);

  const { data: rows } = await supabase
    .from("elections")
    .select(
      "id, office, state, district_code, senate_class, phase, filing_opens_at, filing_closes_at, primary_closes_at, general_closes_at",
    )
    .order("filing_opens_at", { ascending: false });

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

  return <AdminElectionsList rows={dashboardRows} />;
}
