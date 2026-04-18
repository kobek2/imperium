import Link from "next/link";
import { redirect } from "next/navigation";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { tryCreateClient } from "@/lib/supabase/server";
import {
  ElectionsDashboard,
  type DashboardElection,
} from "./elections-dashboard";

export default async function ElectionsPage() {
  const supabase = await tryCreateClient();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to load election data.
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await runElectionPhaseSchedule(supabase);

  const [{ data: elections }, { data: profile }] = await Promise.all([
    supabase
      .from("elections")
      .select(
        "id, office, phase, filing_opens_at, filing_closes_at, primary_closes_at, general_closes_at, district_code, state, senate_class",
      )
      .order("filing_opens_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("home_district_code, residence_state")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const all = (elections ?? []) as Array<
    Omit<DashboardElection, "candidate_count">
  >;
  const active = all.filter((e) => e.phase !== "closed");
  const closedCount = all.length - active.length;

  // Fetch candidate counts for active races in one query.
  const activeIds = active.map((e) => e.id);
  const countsById: Record<string, number> = {};
  if (activeIds.length) {
    const { data: candRows } = await supabase
      .from("election_candidates")
      .select("election_id")
      .in("election_id", activeIds);
    for (const row of candRows ?? []) {
      const id = row.election_id as string;
      countsById[id] = (countsById[id] ?? 0) + 1;
    }
  }

  const dashboardRows: DashboardElection[] = active.map((e) => ({
    ...e,
    candidate_count: countsById[e.id] ?? 0,
  }));

  if (!all.length) {
    return (
      <div className="space-y-8">
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
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Elections</h1>
            <p className="mt-1 max-w-3xl text-sm text-[var(--psc-muted)]">
              No active races right now.
            </p>
          </div>
          <Link
            href="/elections/archive"
            className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)] hover:border-[var(--psc-accent)]"
          >
            Archive ({closedCount})
          </Link>
        </header>
        <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <p className="text-sm text-[var(--psc-muted)]">
            Check the{" "}
            <Link
              href="/elections/archive"
              className="font-semibold text-[var(--psc-accent)] underline"
            >
              archive
            </Link>{" "}
            for results from recent elections.
          </p>
        </section>
      </div>
    );
  }

  return (
    <ElectionsDashboard
      elections={dashboardRows}
      userDistrict={profile?.home_district_code ?? null}
      userState={profile?.residence_state ?? null}
      archiveCount={closedCount}
    />
  );
}
