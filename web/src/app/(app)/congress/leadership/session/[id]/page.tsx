import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { ProfileCard, ProfileCardBadge, profilePath, type ProfileCardData } from "@/components/profile-card";
import { SubmitButton } from "@/components/submit-button";
import {
  canParticipateInRole,
  chamberRoleKey,
  isPartisanLeadershipRole,
  leadershipRoleLabel,
  leadershipRoleShortLabel,
  leadershipRolesForChamber,
  type Chamber,
  type LeadershipRole,
  type PartyKey,
} from "@/lib/leadership";
import {
  castLeadershipVote,
  fileLeadershipCandidacy,
  withdrawLeadershipCandidacy,
} from "@/app/actions/leadership-sessions";

type SessionRow = {
  id: string;
  chamber: Chamber;
  phase: "open" | "closed";
  majority_party: PartyKey;
  opens_at: string;
  closes_at: string;
  closed_at: string | null;
};

type CandidateRow = {
  id: string;
  session_id: string;
  role: string;
  user_id: string;
  created_at: string;
};

type VoteRow = {
  id: string;
  role: string;
  voter_id: string;
  candidate_id: string;
};

function fmtCountdown(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "closing now…";
  const hours = Math.floor(diff / (60 * 60 * 1000));
  const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h ${mins}m left`;
  }
  if (hours >= 1) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

function normalizeParty(p: string | null): PartyKey | null {
  if (p === "democrat" || p === "republican" || p === "independent") return p;
  return null;
}

export default async function LeadershipSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await tryCreateClient();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to open this session.
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await runElectionPhaseSchedule(supabase);

  const { data: sessionRaw } = await supabase
    .from("leadership_sessions")
    .select("id, chamber, phase, majority_party, opens_at, closes_at, closed_at")
    .eq("id", id)
    .maybeSingle();
  if (!sessionRaw) notFound();
  const session = sessionRaw as SessionRow;

  const chamberKey = chamberRoleKey(session.chamber);
  const roles = leadershipRolesForChamber(session.chamber);

  const [{ data: candidates }, { data: votesAll }, { data: myProfileRow }] = await Promise.all([
    supabase
      .from("leadership_session_candidates")
      .select("id, session_id, role, user_id, created_at")
      .eq("session_id", session.id),
    supabase
      .from("leadership_session_votes")
      .select("id, role, voter_id, candidate_id")
      .eq("session_id", session.id),
    supabase
      .from("profiles")
      .select("id, character_name, face_claim_url, party, bio, residence_state, home_district_code, office_role")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const userIds = [
    ...new Set([user.id, ...((candidates ?? []) as CandidateRow[]).map((c) => c.user_id)]),
  ];
  const { data: profilesRows } = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, character_name, face_claim_url, party, bio, residence_state, home_district_code")
        .in("id", userIds)
    : { data: [] as ProfileCardData[] };
  const profileById = new Map(
    (profilesRows ?? []).map((p) => [p.id as string, p as ProfileCardData]),
  );

  const myRoleKeys = await fetchEffectiveRoleKeys(supabase, user.id, myProfileRow ?? null);
  const inChamber = myRoleKeys.includes(chamberKey);
  const myParty = normalizeParty(myProfileRow?.party ?? null);

  const candRows = ((candidates ?? []) as CandidateRow[]).filter((c) =>
    (roles as readonly string[]).includes(c.role),
  );

  const voteRows = ((votesAll ?? []) as VoteRow[]).filter((v) =>
    (roles as readonly string[]).includes(v.role),
  );
  const myVoteByRole = new Map<string, VoteRow>();
  const voteCountByCandidate = new Map<string, number>();
  for (const v of voteRows) {
    voteCountByCandidate.set(v.candidate_id, (voteCountByCandidate.get(v.candidate_id) ?? 0) + 1);
    if (v.voter_id === user.id) myVoteByRole.set(v.role, v);
  }

  const myFiling = candRows.find((c) => c.user_id === user.id);

  const isOpen = session.phase === "open" && new Date(session.closes_at).getTime() > Date.now();

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link href="/congress/leadership" className="text-sm font-semibold text-[var(--psc-accent)]">
          ← Leadership
        </Link>
      </div>

      <header className="space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full border px-3 py-0.5 text-xs font-semibold uppercase tracking-wide ${
              isOpen
                ? "border-amber-700 bg-amber-100 text-amber-900"
                : "border-emerald-700 bg-emerald-100 text-emerald-900"
            }`}
          >
            {isOpen ? "Open" : "Closed"}
          </span>
          <span className="text-xs text-[var(--psc-muted)]">
            Majority caucus: <strong>{session.majority_party}</strong>
          </span>
          <span className="ml-auto font-mono text-xs text-[var(--psc-muted)]">
            {isOpen ? fmtCountdown(session.closes_at) : new Date(session.closes_at).toLocaleString()}
          </span>
        </div>
        <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">
          {session.chamber === "house" ? "House" : "Senate"} leadership election
        </h1>
        <p className="max-w-3xl text-sm text-[var(--psc-muted)]">
          Any sitting {session.chamber === "house" ? "representative" : "senator"} may file to run
          for one of the roles below, and vote on each role. Speaker / President Pro Tempore is a
          chamber-wide ballot; Majority and Minority leader / whip are caucus-scoped. Ties break on
          seniority (earliest {session.chamber === "house" ? "House" : "Senate"} role grant).
        </p>
        {!inChamber ? (
          <p className="rounded border border-amber-700 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            You can watch this session, but only members of the {session.chamber} may file or vote.
          </p>
        ) : null}
        {isOpen && inChamber && myFiling ? (
          <p className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2 text-xs text-[var(--psc-ink)]">
            You are filed for{" "}
            <strong>{leadershipRoleLabel(myFiling.role as LeadershipRole)}</strong>. You may
            withdraw or switch roles below.
          </p>
        ) : null}
      </header>

      <div className="space-y-10">
        {roles.map((role) => (
          <RoleBlock
            key={role}
            role={role}
            session={session}
            allCandidates={candRows}
            profileById={profileById}
            voteCountByCandidate={voteCountByCandidate}
            myVoteRow={myVoteByRole.get(role) ?? null}
            myFiling={myFiling ?? null}
            userId={user.id}
            isOpen={isOpen}
            inChamber={inChamber}
            myParty={myParty}
          />
        ))}
      </div>
    </div>
  );
}

function RoleBlock({
  role,
  session,
  allCandidates,
  profileById,
  voteCountByCandidate,
  myVoteRow,
  myFiling,
  userId,
  isOpen,
  inChamber,
  myParty,
}: {
  role: LeadershipRole;
  session: SessionRow;
  allCandidates: CandidateRow[];
  profileById: Map<string, ProfileCardData>;
  voteCountByCandidate: Map<string, number>;
  myVoteRow: VoteRow | null;
  myFiling: CandidateRow | null;
  userId: string;
  isOpen: boolean;
  inChamber: boolean;
  myParty: PartyKey | null;
}) {
  const cands = allCandidates.filter((c) => c.role === role);
  cands.sort((a, b) => {
    const av = voteCountByCandidate.get(a.id) ?? 0;
    const bv = voteCountByCandidate.get(b.id) ?? 0;
    if (av !== bv) return bv - av;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const totalVotes = cands.reduce(
    (sum, c) => sum + (voteCountByCandidate.get(c.id) ?? 0),
    0,
  );
  const leading = cands.length && (voteCountByCandidate.get(cands[0]!.id) ?? 0) > 0 ? cands[0] : null;

  const eligibleToParticipate = inChamber && canParticipateInRole(role, myParty, session.majority_party);
  const iAlreadyFiledForDifferent = !!myFiling && myFiling.role !== role;
  const iAlreadyFiledForThis = !!myFiling && myFiling.role === role;
  const canFile = isOpen && eligibleToParticipate && !iAlreadyFiledForThis;

  const partisanNote = isPartisanLeadershipRole(role)
    ? role.includes("majority")
      ? `Majority caucus only (${session.majority_party})`
      : `Minority caucus only (not ${session.majority_party})`
    : "Chamber-wide";

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--psc-border)] pb-2">
        <div>
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">
            {leadershipRoleLabel(role)}
          </h2>
          <p className="text-xs text-[var(--psc-muted)]">
            {partisanNote} · {cands.length} candidate{cands.length === 1 ? "" : "s"} · {totalVotes}{" "}
            vote{totalVotes === 1 ? "" : "s"} cast
          </p>
        </div>
        {isOpen && inChamber ? (
          eligibleToParticipate ? (
            canFile ? (
              <form action={fileLeadershipCandidacy}>
                <input type="hidden" name="session_id" value={session.id} />
                <input type="hidden" name="role" value={role} />
                <SubmitButton
                  pendingLabel="Filing…"
                  className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110"
                >
                  {iAlreadyFiledForDifferent
                    ? `Switch filing → ${leadershipRoleShortLabel(role)}`
                    : `File for ${leadershipRoleShortLabel(role)}`}
                </SubmitButton>
              </form>
            ) : iAlreadyFiledForThis ? (
              <form action={withdrawLeadershipCandidacy}>
                <input type="hidden" name="session_id" value={session.id} />
                <SubmitButton
                  pendingLabel="Withdrawing…"
                  className="border border-red-800 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-red-900 hover:bg-red-50"
                >
                  Withdraw filing
                </SubmitButton>
              </form>
            ) : null
          ) : (
            <span className="text-xs text-[var(--psc-muted)]">Not in your caucus</span>
          )
        ) : null}
      </header>

      {!cands.length ? (
        <p className="rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-4 text-sm text-[var(--psc-muted)]">
          No one has filed for this role yet.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cands.map((c) => {
            const profile = profileById.get(c.user_id) ?? {
              id: c.user_id,
              character_name: null,
              face_claim_url: null,
              party: null,
              bio: null,
            };
            const votes = voteCountByCandidate.get(c.id) ?? 0;
            const share = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
            const isMe = c.user_id === userId;
            const myVoteHere = myVoteRow?.candidate_id === c.id;
            const isLeading = leading?.id === c.id;

            const badges = (
              <>
                {isMe ? <ProfileCardBadge tone="you">You</ProfileCardBadge> : null}
                {isLeading ? <ProfileCardBadge tone="leading">Leading</ProfileCardBadge> : null}
                {myVoteHere ? <ProfileCardBadge tone="nominee">Your vote</ProfileCardBadge> : null}
              </>
            );

            const footer = (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between text-xs text-[var(--psc-muted)]">
                  <span className="font-semibold text-[var(--psc-ink)]">
                    {votes} vote{votes === 1 ? "" : "s"}
                  </span>
                  <span className="font-mono">{share}%</span>
                </div>
                {isOpen && eligibleToParticipate ? (
                  <form action={castLeadershipVote} className="flex gap-2">
                    <input type="hidden" name="session_id" value={session.id} />
                    <input type="hidden" name="role" value={role} />
                    <input
                      type="hidden"
                      name="candidate_id"
                      value={myVoteHere ? "" : c.id}
                    />
                    <SubmitButton
                      pendingLabel={myVoteHere ? "Removing…" : "Voting…"}
                      className={`flex-1 border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                        myVoteHere
                          ? "border-red-800 bg-white text-red-900 hover:bg-red-50"
                          : "border-[var(--psc-ink)] bg-[var(--psc-ink)] text-white hover:brightness-110"
                      }`}
                    >
                      {myVoteHere ? "Unvote" : "Vote"}
                    </SubmitButton>
                  </form>
                ) : null}
              </div>
            );

            return (
              <li key={c.id}>
                <ProfileCard
                  profile={profile}
                  href={profilePath(c.user_id) ?? undefined}
                  badges={badges}
                  footer={footer}
                  emphasizeParty
                  selected={myVoteHere}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export const dynamic = "force-dynamic";
