import { notFound, redirect } from "next/navigation";
import {
  getFilingEligibilityMessage,
  loadActiveCandidacySlots,
} from "@/lib/election-filing";
import { endorsementPointsForRoles } from "@/lib/fec";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import {
  isLeadershipRole,
  isPartisanLeadershipRole,
  leadershipRoleLabel,
  requiredChamberRoleKey,
  type LeadershipRole,
} from "@/lib/leadership";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerAuth } from "@/lib/supabase/server";
import { getStaffMayAccessElectionsConsole } from "@/lib/staff-access";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { ElectionConsole } from "./election-console";
import { ElectionDetail } from "./election-detail";
import { fetchElectionCandidatesForListing } from "@/lib/election-candidate-queries";
import { sumCampaignAdInventory } from "@/lib/campaign-ad-inventory";
import { seedElectionNpcOpponents } from "@/lib/election-npc-opponents";
import {
  campaignAdCountFromPoints,
  campaignAdSpendUsd,
  sumCampaignAdPointsForElection,
} from "@/lib/campaign-ad-stats";
import { fetchUserSenateClassHeld } from "@/lib/senate-seat-class";
import {
  fetchAllCampaignSpeechesForElection,
  toCampaignSpeechArchiveItems,
} from "@/lib/campaign-speeches";
import type { CampaignSpeechArchiveItem } from "@/components/campaign-speech-archive";

/** Always refetch election + map from Supabase; avoids stale RSC after env or DB changes. */
export const dynamic = "force-dynamic";

// Module-level promise cache for the (static) US states list. The rows never change during
// the life of a Vercel build/lambda, so we reuse the first successful fetch for subsequent
// requests instead of hitting Postgres on every page view.
type StateRow = { code: string; name: string };
let statesPromise: Promise<StateRow[]> | null = null;
function getStatesCached(supabase: SupabaseClient | null) {
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
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to manage elections.
      </div>
    );
  }

  if (!user) redirect("/login");

  await runElectionPhaseSchedule(supabase);

  const { data: election } = await supabase.from("elections").select("*").eq("id", id).maybeSingle();
  if (!election) notFound();

  if (election.phase === "primary" && !election.leadership_role) {
    try {
      await seedElectionNpcOpponents(supabase, id);
    } catch (err) {
      console.warn("[elections/[id]] seed npc opponents failed:", err);
    }
  }

  if (election.phase === "general") {
    await supabase.rpc("tick_npc_campaigns", { p_election_id: id });
  }

  const candList = await fetchElectionCandidatesForListing(supabase, id);

  // Remaining per-election queries are independent, so we fan them out in parallel.
  const [
    { data: primaryVoteRows },
    { data: generalVoteRows },
    { data: myPrimaryVote },
    { data: myGeneralVote },
    { data: myEndorsement },
    { data: myProfile },
    activeSlots,
    { data: speechRows },
    { data: rallyRows },
    { data: campaignAdRows },
    states,
    isAdmin,
    partisanLean,
    winnerLookup,
    { data: adInventoryRows },
    { data: npcActivityRows },
  ] = await Promise.all([
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
      .from("campaign_endorsements")
      .select("candidate_id")
      .eq("election_id", id)
      .eq("endorser_user_id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("party, residence_state, home_district_code, office_role")
      .eq("id", user.id)
      .maybeSingle(),
    loadActiveCandidacySlots(supabase, user.id),
    supabase
      .from("campaign_speeches")
      .select("candidate_id, author_id, content, target_state, created_at")
      .eq("election_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("campaign_rallies").select("candidate_id").eq("election_id", id),
    supabase
      .from("campaign_ads")
      .select("actor_id, candidate_id, target_state, points, created_at")
      .eq("election_id", id)
      .order("created_at", { ascending: false })
      .limit(5000),
    getStatesCached(supabase),
    getStaffMayAccessElectionsConsole(),
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
      if (election.winner_user_id) {
        const { data } = await supabase
          .from("profiles")
          .select("character_name")
          .eq("id", election.winner_user_id)
          .maybeSingle();
        return { playerName: data?.character_name ?? null, npcName: null as string | null };
      }
      const winnerCandidateId = (election as { winner_candidate_id?: string | null })
        .winner_candidate_id;
      if (winnerCandidateId) {
        const { data } = await supabase
          .from("election_candidates")
          .select("is_npc, npc_name")
          .eq("id", winnerCandidateId)
          .maybeSingle();
        if (data?.is_npc && data.npc_name?.trim()) {
          return { playerName: null as string | null, npcName: data.npc_name.trim() };
        }
      }
      return { playerName: null as string | null, npcName: null as string | null };
    })(),
    supabase
      .from("economy_inventory")
      .select("sku, quantity")
      .eq("user_id", user.id)
      .in("sku", ["campaign_ad_persuasion", "campaign_ad_attack", "campaign_ad"]),
    supabase
      .from("npc_campaign_actions")
      .select("id, action_type, succeeded, points_delta, message, created_at")
      .eq("election_id", id)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const effectiveRoleKeys = await fetchEffectiveRoleKeys(supabase, user.id, myProfile ?? null);
  const myEndorsementPoints = endorsementPointsForRoles(effectiveRoleKeys);

  const heldSenateClass =
    election.office === "senate" ? await fetchUserSenateClassHeld(supabase, user.id) : null;
  const viewerIsIncumbentForThisSenateSeat =
    election.office === "senate" &&
    election.senate_class != null &&
    heldSenateClass != null &&
    Number(election.senate_class) === heldSenateClass &&
    String(myProfile?.residence_state ?? "")
      .trim()
      .toUpperCase() === String(election.state ?? "").trim().toUpperCase();

  // Pre-compute filing eligibility server-side so the detail component can show the right
  // hint or File button without knowing the rules. Leadership races branch to a different
  // eligibility check (chamber role + caucus party); seat races use the existing helper.
  let filingBlockReason: string | null = null;
  if (isLeadershipRole(election.leadership_role)) {
    const role = election.leadership_role as LeadershipRole;
    const needed = requiredChamberRoleKey(role);
    if (!effectiveRoleKeys.includes(needed)) {
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
  const canCastLeadershipGeneralVote = (() => {
    if (!leadershipMeta) return false;
    const needed = requiredChamberRoleKey(leadershipMeta.role);
    if (!effectiveRoleKeys.includes(needed)) return false;
    if (
      isPartisanLeadershipRole(leadershipMeta.role) &&
      leadershipMeta.restricted_party &&
      (myProfile?.party ?? "").toLowerCase() !== leadershipMeta.restricted_party
    ) {
      return false;
    }
    return true;
  })();

  type ProfileCardRow = {
    id: string;
    character_name: string | null;
    face_claim_url: string | null;
    residence_state: string | null;
    home_district_code: string | null;
    bio: string | null;
  };
  let profiles: ProfileCardRow[] = [];
  if (candList.length || (speechRows?.length ?? 0) > 0) {
    const profileIds = new Set<string>();
    for (const c of candList) {
      if (c.user_id) profileIds.add(c.user_id);
      if (c.running_mate_user_id) profileIds.add(c.running_mate_user_id);
    }
    for (const s of (speechRows ?? []) as Array<{ author_id: string }>) {
      profileIds.add(s.author_id);
    }
    for (const a of (campaignAdRows ?? []) as Array<{ actor_id: string }>) {
      profileIds.add(a.actor_id);
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
  for (const c of candList) {
    if (c.is_npc) {
      generalTally[c.id] = Math.max(0, Number(c.npc_synthetic_votes ?? 0));
    }
  }
  for (const row of generalVoteRows ?? []) {
    const cid = row.candidate_id as string;
    generalTally[cid] = (generalTally[cid] ?? 0) + 1;
  }

  const speechCountBy: Record<string, number> = {};
  for (const row of speechRows ?? []) {
    const cid = row.candidate_id as string;
    speechCountBy[cid] = (speechCountBy[cid] ?? 0) + 1;
  }
  const speechRowsForFeed = ((speechRows ?? []) as Array<{
    candidate_id: string;
    author_id: string;
    content: string;
    target_state: string | null;
    created_at: string;
  }>).map((s) => ({
    candidateId: s.candidate_id,
    authorId: s.author_id,
    content: s.content,
    targetState: s.target_state ? String(s.target_state).toUpperCase() : null,
    createdAt: s.created_at,
  }));

  const candidateUserIdByCandId = new Map(
    candList.map((c) => [c.id as string, c.user_id as string]),
  );
  let speechArchive: CampaignSpeechArchiveItem[] | null = null;
  if (election.phase === "closed") {
    try {
      const allSpeeches = await fetchAllCampaignSpeechesForElection(supabase, id);
      for (const s of allSpeeches) {
        speechCountBy[s.candidate_id] = (speechCountBy[s.candidate_id] ?? 0) + 1;
      }
      const authorIds = [...new Set(allSpeeches.map((s) => s.author_id))].filter(
        (aid) => !nameBy[aid],
      );
      if (authorIds.length) {
        const { data: authorProfiles } = await supabase
          .from("profiles")
          .select("id, character_name, face_claim_url, residence_state, home_district_code, bio")
          .in("id", authorIds);
        for (const p of authorProfiles ?? []) {
          nameBy[p.id as string] = (p.character_name as string | null) ?? "";
          candidateCardByUserId[p.id as string] = {
            character_name: p.character_name as string | null,
            face_claim_url: p.face_claim_url as string | null,
            residence_state: p.residence_state as string | null,
            home_district_code: p.home_district_code as string | null,
            bio: p.bio as string | null,
          };
        }
      }
      const displayName = (userId: string) =>
        candidateCardByUserId[userId]?.character_name?.trim() ||
        nameBy[userId]?.trim() ||
        userId.slice(0, 8);
      speechArchive = toCampaignSpeechArchiveItems(allSpeeches, {
        candidateName: (candidateId) => {
          const userId = candidateUserIdByCandId.get(candidateId);
          return userId ? displayName(userId) : candidateId.slice(0, 8);
        },
        authorName: (authorId) => displayName(authorId),
      });
    } catch (err) {
      console.warn("[elections/[id]] closed speech archive failed:", err);
    }
  }
  /** Bulk `economy_use_campaign_ad` inserts share one `created_at` — merge into one line per spend. */
  const adSpendFeed = (() => {
    const raw = (campaignAdRows ?? []) as Array<{
      actor_id: string;
      candidate_id: string;
      target_state: string | null;
      points: number | null;
      created_at: string;
    }>;
    const bucket = new Map<
      string,
      { actorId: string; candidateId: string; targetState: string | null; points: number; createdAt: string }
    >();
    for (const a of raw) {
      const targetState = a.target_state ? String(a.target_state).trim().toUpperCase() : null;
      const key = `${a.actor_id}\t${a.candidate_id}\t${targetState ?? ""}\t${a.created_at}`;
      const pts = Number(a.points ?? 1);
      const cur = bucket.get(key);
      if (cur) cur.points += pts;
      else
        bucket.set(key, {
          actorId: a.actor_id,
          candidateId: a.candidate_id,
          targetState,
          points: pts,
          createdAt: a.created_at,
        });
    }
    return [...bucket.values()]
      .sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime())
      .slice(0, 100);
  })();
  const rallyCountBy: Record<string, number> = {};
  for (const row of rallyRows ?? []) {
    const cid = row.candidate_id as string;
    rallyCountBy[cid] = (rallyCountBy[cid] ?? 0) + 1;
  }
  const adsInventory = sumCampaignAdInventory(
    (adInventoryRows ?? []) as Array<{ sku: string; quantity: number | null }>,
  );

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
        ) ??
        (myEndorsement?.candidate_id
          ? candList.find((c) => c.id === myEndorsement.candidate_id)
          : undefined)
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

  const totalCampaignAdPoints = election.leadership_role
    ? 0
    : await sumCampaignAdPointsForElection(supabase, id);
  const totalCampaignAdSpendUsd = campaignAdSpendUsd(totalCampaignAdPoints);
  const totalCampaignAdsPlaced = campaignAdCountFromPoints(totalCampaignAdPoints);

  return (
    <div className="space-y-6">
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
        myEndorsedCandidateId={myEndorsement?.candidate_id ?? null}
        myEndorsementPoints={myEndorsementPoints}
        profileParty={myProfile?.party ?? null}
        filingBlockReason={filingBlockReason}
        userId={user.id}
        isAdmin={isAdmin}
        winnerName={winnerLookup.playerName}
        winnerNpcName={winnerLookup.npcName}
        partisanLean={partisanLean}
        speechCountBy={speechCountBy}
        rallyCountBy={rallyCountBy}
        myRalliesInWindow={myRalliesInWindow}
        myNextRallyAt={myNextRallyAt}
        states={states}
        leadershipMeta={leadershipMeta}
        canCastLeadershipGeneralVote={canCastLeadershipGeneralVote}
        adsInventory={adsInventory}
        speechFeed={speechArchive ? [] : speechRowsForFeed}
        speechArchive={speechArchive}
        adSpendFeed={adSpendFeed}
        totalCampaignAdSpendUsd={totalCampaignAdSpendUsd}
        totalCampaignAdsPlaced={totalCampaignAdsPlaced}
        viewerIsIncumbentForThisSenateSeat={viewerIsIncumbentForThisSenateSeat}
        npcActivity={(npcActivityRows ?? []) as Array<{
          id: string;
          action_type: string;
          succeeded: boolean;
          points_delta: number;
          message: string;
          created_at: string;
        }>}
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
