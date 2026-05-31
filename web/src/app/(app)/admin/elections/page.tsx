import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/server";
import { getStaffAccess, requireStaffPageAny } from "@/lib/staff-access";
import { countElectionCandidatesByElectionIds } from "@/lib/election-candidate-queries";
import { computeSimulationRpInstant, formatRpCalendarShort, type SimulationSettingsRow } from "@/lib/simulation-calendar";
import { resolveSimulationSettingsForWidget } from "@/lib/simulation-widget-data";
import {
  AdminElectionsList,
  type AdminElectionRow,
} from "./admin-elections-list";
import { AdminElectionSimulationButtons } from "./admin-election-simulation-buttons";
import { AdminCalendarMonthControls } from "./admin-calendar-month-controls";
import { AdminCongressAppointmentsClient } from "./admin-congress-appointments-client";
import { loadChamberSeatHolders, loadExecutiveOfficers } from "@/lib/admin-congress-appointment-queries";
import { recomputeClosedLeadershipSession } from "@/app/actions/leadership-sessions";

type LeadershipArchiveSession = {
  id: string;
  chamber: "house" | "senate";
  majority_party: "democrat" | "republican" | "independent";
  opens_at: string;
  closes_at: string;
  closed_at: string | null;
  candidates: Array<{
    id: string;
    role: string;
    user_id: string;
    name: string;
  }>;
  votes: Array<{
    role: string;
    voter_id: string;
    voter_name: string;
    candidate_id: string;
  }>;
};

export default async function AdminElectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireStaffPageAny(["elections", "simulation"]);

  const { tab } = await searchParams;
  const electionView: "active" | "archive" = tab === "archive" ? "archive" : "active";

  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/");

  const staffAccess = await getStaffAccess();
  const canRunSimSettingsHeal = Boolean(staffAccess?.hasFullStaff);

  const [{ data: rows }, { data: simSettingsRaw }] = await Promise.all([
      supabase
        .from("elections")
        .select(
          "id, office, state, district_code, senate_class, phase, filing_opens_at, filing_closes_at, primary_closes_at, general_closes_at, leadership_role, restricted_party, filing_window_started_at",
        )
        .order("filing_opens_at", { ascending: false }),
      supabase.from("simulation_settings").select("*").eq("id", 1).maybeSingle(),
    ]);

  const list = (rows ?? []) as Array<Omit<AdminElectionRow, "candidate_count">>;

  const countsById = list.length
    ? await countElectionCandidatesByElectionIds(
        supabase,
        list.map((r) => r.id),
      )
    : {};

  const dashboardRows: AdminElectionRow[] = list.map((r) => ({
    ...r,
    candidate_count: countsById[r.id] ?? 0,
  }));

  const closedCount = dashboardRows.filter((r) => r.phase === "closed").length;
  const simSettingsForDisplay = simSettingsRaw
    ? await resolveSimulationSettingsForWidget(
        supabase,
        simSettingsRaw as SimulationSettingsRow,
        canRunSimSettingsHeal,
      )
    : null;
  const simDateLabel = simSettingsForDisplay
    ? formatRpCalendarShort(computeSimulationRpInstant(simSettingsForDisplay, new Date()))
    : "Unavailable";

  const canAppointSeats = Boolean(staffAccess?.hasFullStaff);
  let houseAppointmentMembers: Awaited<ReturnType<typeof loadChamberSeatHolders>> = [];
  let senateAppointmentMembers: Awaited<ReturnType<typeof loadChamberSeatHolders>> = [];
  let executiveOfficers: Awaited<ReturnType<typeof loadExecutiveOfficers>> = {
    president: null,
    vicePresident: null,
  };
  if (canAppointSeats) {
    [houseAppointmentMembers, senateAppointmentMembers, executiveOfficers] = await Promise.all([
      loadChamberSeatHolders(supabase, "house"),
      loadChamberSeatHolders(supabase, "senate"),
      loadExecutiveOfficers(supabase),
    ]);
  }

  let leadershipArchive: LeadershipArchiveSession[] = [];
  if (electionView === "archive") {
    const { data: closedSessions } = await supabase
      .from("leadership_sessions")
      .select("id, chamber, majority_party, opens_at, closes_at, closed_at")
      .eq("phase", "closed")
      .order("closed_at", { ascending: false, nullsFirst: false })
      .limit(25);
    const sessions = (closedSessions ?? []) as Array<{
      id: string;
      chamber: "house" | "senate";
      majority_party: "democrat" | "republican" | "independent";
      opens_at: string;
      closes_at: string;
      closed_at: string | null;
    }>;
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length) {
      const [{ data: candRows }, { data: voteRows }] = await Promise.all([
        supabase
          .from("leadership_session_candidates")
          .select("id, session_id, role, user_id")
          .in("session_id", sessionIds),
        supabase
          .from("leadership_session_votes")
          .select("session_id, role, voter_id, candidate_id")
          .in("session_id", sessionIds),
      ]);
      const userIdSet = new Set<string>();
      for (const row of candRows ?? []) userIdSet.add(String((row as { user_id: string }).user_id));
      for (const row of voteRows ?? []) userIdSet.add(String((row as { voter_id: string }).voter_id));
      const userIds = [...userIdSet];
      const { data: people } = userIds.length
        ? await supabase.from("profiles").select("id, character_name, discord_username").in("id", userIds)
        : { data: [] as never[] };
      const nameByUserId = new Map(
        ((people ?? []) as Array<{ id: string; character_name: string | null; discord_username: string | null }>).map(
          (p) => [p.id, p.character_name?.trim() || p.discord_username?.trim() || `User ${p.id.slice(0, 8)}`] as const,
        ),
      );
      const candsBySession = new Map<string, LeadershipArchiveSession["candidates"]>();
      for (const row of (candRows ?? []) as Array<{ id: string; session_id: string; role: string; user_id: string }>) {
        const list = candsBySession.get(row.session_id) ?? [];
        list.push({
          id: row.id,
          role: row.role,
          user_id: row.user_id,
          name: nameByUserId.get(row.user_id) ?? `User ${row.user_id.slice(0, 8)}`,
        });
        candsBySession.set(row.session_id, list);
      }
      const votesBySession = new Map<string, LeadershipArchiveSession["votes"]>();
      for (const row of (voteRows ?? []) as Array<{ session_id: string; role: string; voter_id: string; candidate_id: string }>) {
        const list = votesBySession.get(row.session_id) ?? [];
        list.push({
          role: row.role,
          voter_id: row.voter_id,
          voter_name: nameByUserId.get(row.voter_id) ?? `User ${row.voter_id.slice(0, 8)}`,
          candidate_id: row.candidate_id,
        });
        votesBySession.set(row.session_id, list);
      }
      leadershipArchive = sessions.map((s) => ({
        ...s,
        candidates: candsBySession.get(s.id) ?? [],
        votes: votesBySession.get(s.id) ?? [],
      }));
    }
  }

  return (
    <div className="space-y-6">
      <AdminCalendarMonthControls simDateLabel={simDateLabel} />
      <AdminElectionSimulationButtons />
      <AdminCongressAppointmentsClient
        canAppoint={canAppointSeats}
        houseMembers={houseAppointmentMembers}
        senateMembers={senateAppointmentMembers}
        president={executiveOfficers.president}
        vicePresident={executiveOfficers.vicePresident}
      />
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
        {electionView === "archive" && leadershipArchive.length ? (
          <section className="space-y-3 rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
            <h3 className="text-lg font-semibold text-[var(--psc-ink)]">
              Leadership election archive (House/Senate sessions)
            </h3>
            <div className="space-y-3">
              {leadershipArchive.map((session) => {
                const candidateById = new Map(session.candidates.map((c) => [c.id, c]));
                const roles = [...new Set(session.candidates.map((c) => c.role))];
                return (
                  <article
                    key={session.id}
                    className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-[var(--psc-ink)]">
                        {session.chamber === "house" ? "House" : "Senate"} leadership session
                      </p>
                      <div className="flex items-center gap-3">
                        <p className="text-xs text-[var(--psc-muted)]">
                          {new Date(session.opens_at).toLocaleString()} -{" "}
                          {new Date(session.closed_at ?? session.closes_at).toLocaleString()}
                        </p>
                        <form action={recomputeClosedLeadershipSession}>
                          <input type="hidden" name="session_id" value={session.id} />
                          <button
                            type="submit"
                            className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white hover:brightness-110"
                          >
                            Recompute winner
                          </button>
                        </form>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-[var(--psc-muted)]">
                      Majority party at opening: <strong className="text-[var(--psc-ink)]">{session.majority_party}</strong>
                    </p>
                    <div className="mt-3 space-y-3">
                      {roles.map((role) => {
                        const roleCands = session.candidates.filter((c) => c.role === role);
                        const roleVotes = session.votes.filter((v) => v.role === role);
                        return (
                          <div key={role} className="rounded border border-[var(--psc-border)] bg-white p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--psc-muted)]">
                              {role.replaceAll("_", " ")}
                            </p>
                            <ul className="mt-1 text-sm text-[var(--psc-ink)]">
                              {roleCands.map((cand) => (
                                <li key={cand.id}>
                                  {cand.name} - {roleVotes.filter((v) => v.candidate_id === cand.id).length} vote(s)
                                </li>
                              ))}
                            </ul>
                            <p className="mt-2 text-xs font-semibold text-[var(--psc-muted)]">Who voted for who</p>
                            {roleVotes.length ? (
                              <ul className="mt-1 list-disc pl-4 text-xs text-[var(--psc-ink)]">
                                {roleVotes.map((vote, idx) => (
                                  <li key={`${vote.voter_id}-${vote.candidate_id}-${idx}`}>
                                    {vote.voter_name} {"->"} {candidateById.get(vote.candidate_id)?.name ?? "Unknown candidate"}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-1 text-xs text-[var(--psc-muted)]">No votes cast for this role.</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
