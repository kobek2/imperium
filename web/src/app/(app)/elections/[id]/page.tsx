import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getFilingEligibilityMessage,
  loadActiveCandidacySlots,
} from "@/lib/election-filing";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import {
  isLeadershipRole,
  isPartisanLeadershipRole,
  leadershipRoleLabel,
  requiredChamberRoleKey,
  type LeadershipRole,
} from "@/lib/leadership";
import { tryCreateClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";
import { ElectionConsole } from "./election-console";
import { ElectionDetail } from "./election-detail";
import { PresidentialMap } from "./presidential-map";
import { ElectoralTote } from "./electoral-tote";
import {
  loadPresidentialBundle,
  scorePresidentialBundle,
} from "@/lib/presidential-data";

// Module-level promise cache for the (static) US states list. The rows never change during
// the life of a Vercel build/lambda, so we reuse the first successful fetch for subsequent
// requests instead of hitting Postgres on every page view.
type StateRow = { code: string; name: string };
let statesPromise: Promise<StateRow[]> | null = null;
function getStatesCached(supabase: Awaited<ReturnType<typeof tryCreateClient>>) {
  if (!supabase) return Promise.resolve([] as StateRow[]);
  if (!statesPromise) {
    statesPromise = (async () => {
      try {
        const { data } = await supabase.from("states").select("code, name").order("code");
        return (data ?? []) as StateRow[];
      } catch {
        // Don't cache a failure; allow the next caller to retry.
        statesPromise = null;
        return [] as StateRow[];
      }
    })();
  }
  return statesPromise;
}

export default async function ElectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to manage elections.
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await runElectionPhaseSchedule(supabase);

  const { data: election } = await supabase.from("elections").select("*").eq("id", id).maybeSingle();
  if (!election) notFound();

  // All of the per-election queries below are independent, so we fan them out in parallel
  // instead of awaiting each sequentially (previously this page had ~10 serial round-trips).
  const [
    { data: candidates },
    { data: primaryVoteRows },
    { data: generalVoteRows },
    { data: myPrimaryVote },
    { data: myGeneralVote },
    { data: myProfile },
    activeSlots,
    { data: speechRows },
    { data: rallyRows },
    states,
    isAdmin,
    partisanLean,
    winnerName,
  ] = await Promise.all([
    supabase
      .from("election_candidates")
      .select("id, party, campaign_points_total, user_id, primary_winner, created_at, running_mate_user_id")
      .eq("election_id", id)
      .order("id", { ascending: true }),
    supabase.from("primary_votes").select("candidate_id").eq("election_id", id),
    supabase.from("general_votes").select("candidate_id").eq("election_id", id),
    supabase
      .from("primary_votes")
      .select("candidate_id")
      .eq("election_id", id)
      .eq("voter_id", user.id)
      .maybeSingle(),
    supabase
      .from("general_votes")
      .select("candidate_id")
      .eq("election_id", id)
      .eq("voter_id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("party, residence_state, home_district_code, office_role")
      .eq("id", user.id)
      .maybeSingle(),
    loadActiveCandidacySlots(supabase, user.id),
    supabase.from("campaign_speeches").select("candidate_id").eq("election_id", id),
    supabase.from("campaign_rallies").select("candidate_id").eq("election_id", id),
    getStatesCached(supabase),
    getIsAdmin(),
    (async () => {
      if (election.office === "house" && election.district_code) {
        const { data } = await supabase
          .from("districts")
          .select("pvi")
          .eq("code", election.district_code)
          .maybeSingle();
        return Number(data?.pvi ?? 0);
      }
      if (election.office === "senate" && election.state) {
        const { data } = await supabase
          .from("states")
          .select("pvi")
          .eq("code", election.state)
          .maybeSingle();
        return Number(data?.pvi ?? 0);
      }
      return 0;
    })(),
    (async () => {
      if (!election.winner_user_id) return null;
      const { data } = await supabase
        .from("profiles")
        .select("character_name")
        .eq("id", election.winner_user_id)
        .maybeSingle();
      return data?.character_name ?? null;
    })(),
  ]);

  const candList = candidates ?? [];

  // Pre-compute filing eligibility server-side so the detail component can show the right
  // hint or File button without knowing the rules. Leadership races branch to a different
  // eligibility check (chamber role + caucus party); seat races use the existing helper.
  let filingBlockReason: string | null = null;
  if (isLeadershipRole(election.leadership_role)) {
    const role = election.leadership_role as LeadershipRole;
    const needed = requiredChamberRoleKey(role);
    const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, myProfile ?? null);
    if (!roleKeys.includes(needed)) {
      const label = needed === "representative" ? "representatives" : "senators";
      filingBlockReason = `Only sitting ${label} can file for this leadership race.`;
    } else if (
      isPartisanLeadershipRole(role) &&
      election.restricted_party &&
      (myProfile?.party ?? "").toLowerCase() !== election.restricted_party
    ) {
      filingBlockReason = `This caucus race is restricted to the ${election.restricted_party} caucus.`;
    }
  } else {
    filingBlockReason = getFilingEligibilityMessage(
      election.office,
      { state: election.state, district_code: election.district_code },
      myProfile
        ? {
            party: myProfile.party,
            residence_state: myProfile.residence_state,
            home_district_code: myProfile.home_district_code,
          }
        : null,
      activeSlots,
    );
  }

  const leadershipMeta = isLeadershipRole(election.leadership_role)
    ? {
        role: election.leadership_role as LeadershipRole,
        label: leadershipRoleLabel(election.leadership_role as LeadershipRole),
        restricted_party: (election.restricted_party ?? null) as
          | "democrat"
          | "republican"
          | "independent"
          | null,
      }
    : null;

  type ProfileCardRow = {
    id: string;
    character_name: string | null;
    face_claim_url: string | null;
    residence_state: string | null;
    home_district_code: string | null;
    bio: string | null;
  };
  let profiles: ProfileCardRow[] = [];
  if (candList.length) {
    const profileIds = new Set<string>();
    for (const c of candList) {
      profileIds.add(c.user_id as string);
      if (c.running_mate_user_id) profileIds.add(c.running_mate_user_id as string);
    }
    const { data: p } = await supabase
      .from("profiles")
      .select("id, character_name, face_claim_url, residence_state, home_district_code, bio")
      .in("id", [...profileIds]);
    profiles = p ?? [];
  }
  const nameBy = Object.fromEntries(profiles.map((p) => [p.id, p.character_name ?? ""]));
  const candidateCardByUserId = Object.fromEntries(
    profiles.map((p) => [
      p.id,
      {
        character_name: p.character_name,
        face_claim_url: p.face_claim_url,
        residence_state: p.residence_state,
        home_district_code: p.home_district_code,
        bio: p.bio,
      },
    ]),
  );

  const primaryTally: Record<string, number> = {};
  for (const row of primaryVoteRows ?? []) {
    const cid = row.candidate_id as string;
    primaryTally[cid] = (primaryTally[cid] ?? 0) + 1;
  }

  const generalTally: Record<string, number> = {};
  for (const row of generalVoteRows ?? []) {
    const cid = row.candidate_id as string;
    generalTally[cid] = (generalTally[cid] ?? 0) + 1;
  }

  const speechCountBy: Record<string, number> = {};
  for (const row of speechRows ?? []) {
    const cid = row.candidate_id as string;
    speechCountBy[cid] = (speechCountBy[cid] ?? 0) + 1;
  }
  const rallyCountBy: Record<string, number> = {};
  for (const row of rallyRows ?? []) {
    const cid = row.candidate_id as string;
    rallyCountBy[cid] = (rallyCountBy[cid] ?? 0) + 1;
  }

  // Per-user rally rate-limit window: 10 rallies / 3 hours. This is one tiny follow-up query;
  // it only runs if the user is actually a candidate in this race.
  const RALLY_WINDOW_MS = 3 * 60 * 60 * 1000;
  const RALLY_LIMIT = 10;
  let myRalliesInWindow = 0;
  let myNextRallyAt: string | null = null;
  const myCand =
    election.office === "president"
      ? candList.find(
          (c) => c.user_id === user.id || (c as { running_mate_user_id?: string | null }).running_mate_user_id === user.id,
        )
      : candList.find((c) => c.user_id === user.id);
  if (myCand) {
    // Server-only rate-limit anchor; not render-purity sensitive.
    // eslint-disable-next-line react-hooks/purity -- Date.now() for rolling rally window
    const windowStart = new Date(Date.now() - RALLY_WINDOW_MS).toISOString();
    const { data: myRallyRows } = await supabase
      .from("campaign_rallies")
      .select("created_at")
      .eq("election_id", id)
      .eq("candidate_id", myCand.id)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: true });
    const rows = myRallyRows ?? [];
    myRalliesInWindow = rows.length;
    if (myRalliesInWindow >= RALLY_LIMIT && rows[0]) {
      const oldest = new Date(rows[0].created_at as string).getTime();
      myNextRallyAt = new Date(oldest + RALLY_WINDOW_MS).toISOString();
    }
  }

  // Presidential races run on state-by-state 60/40 scoring + winner-take-all electoral college.
  // The bundle + result are the same shape the admin `finalizePresident` action uses, so what
  // you see on the page is what gets certified on close.
  let presMapData: {
    states: Array<{ code: string; name: string; pvi: number; electoral_votes: number }>;
    result: ReturnType<typeof scorePresidentialBundle>;
    candidatesBrief: Array<{ id: string; user_id: string; party: string; name: string }>;
  } | null = null;
  if (election.office === "president") {
    try {
      const bundle = await loadPresidentialBundle(supabase, id);
      const result = scorePresidentialBundle(bundle);
      presMapData = {
        states: bundle.states,
        result,
        candidatesBrief: bundle.candidates.map((c) => ({
          id: c.id,
          user_id: c.user_id,
          party: c.party,
          name:
            nameBy[c.user_id]?.trim() ||
            candidateCardByUserId[c.user_id]?.character_name?.trim() ||
            c.user_id.slice(0, 8),
        })),
      };
    } catch (err) {
      console.warn("[elections/[id]] presidential map data failed:", err);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/elections" className="text-sm font-semibold text-[var(--psc-accent)]">
        ← All elections
      </Link>
      {presMapData ? (
        <div className="space-y-3">
          <ElectoralTote
            candidates={presMapData.candidatesBrief}
            evByCandidate={presMapData.result.electoralVotesByCandidate}
            totalEV={presMapData.result.totalElectoralVotes}
          />
          <PresidentialMap
            states={presMapData.states}
            result={presMapData.result}
            candidates={presMapData.candidatesBrief}
          />
        </div>
      ) : null}
      <ElectionDetail
        election={election}
        candidates={candList.map((c) => {
          const mateId = (c as { running_mate_user_id?: string | null }).running_mate_user_id;
          const mateName = mateId ? nameBy[mateId]?.trim() || null : null;
          return {
            ...c,
            primary_winner: c.primary_winner ?? false,
            campaign_points_total: c.campaign_points_total,
            created_at: c.created_at ?? null,
            running_mate_user_id: mateId ?? null,
            running_mate_name: mateName,
          };
        })}
        nameBy={nameBy}
        candidateCardByUserId={candidateCardByUserId}
        primaryTally={primaryTally}
        generalTally={generalTally}
        myPrimaryCandidateId={myPrimaryVote?.candidate_id ?? null}
        myGeneralCandidateId={myGeneralVote?.candidate_id ?? null}
        profileParty={myProfile?.party ?? null}
        filingBlockReason={filingBlockReason}
        userId={user.id}
        isAdmin={isAdmin}
        winnerName={winnerName}
        partisanLean={partisanLean}
        speechCountBy={speechCountBy}
        rallyCountBy={rallyCountBy}
        myRalliesInWindow={myRalliesInWindow}
        myNextRallyAt={myNextRallyAt}
        states={states}
        leadershipMeta={leadershipMeta}
      />
      {isAdmin ? (
        <details className="border border-dashed border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 text-sm">
          <summary className="cursor-pointer font-semibold text-[var(--psc-muted)]">
            Math preview (admin demo)
          </summary>
          <div className="mt-4">
            <ElectionConsole
              election={{
                id: election.id,
                office: election.office,
                phase: election.phase,
                state: election.state,
                district_code: election.district_code,
              }}
              candidates={candList.map((c) => ({
                id: c.id,
                party: c.party as "democrat" | "republican" | "independent",
                campaign_points_total: Number(c.campaign_points_total ?? 0),
                user_id: c.user_id,
              }))}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}
