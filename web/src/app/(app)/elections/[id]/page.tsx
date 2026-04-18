import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadActiveCandidacySlots } from "@/lib/election-filing";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { tryCreateClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";
import { ElectionConsole } from "./election-console";
import { ElectionDetail } from "./election-detail";

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

  const { data: candidates } = await supabase
    .from("election_candidates")
    .select("id, party, campaign_points_total, user_id, primary_winner, created_at")
    .eq("election_id", id)
    .order("id", { ascending: true });

  const candList = candidates ?? [];
  type ProfileCardRow = {
    id: string;
    character_name: string | null;
    face_claim_url: string | null;
    residence_state: string | null;
    home_district_code: string | null;
  };
  let profiles: ProfileCardRow[] = [];
  if (candList.length) {
    const { data: p } = await supabase
      .from("profiles")
      .select("id, character_name, face_claim_url, residence_state, home_district_code")
      .in(
        "id",
        candList.map((c) => c.user_id),
      );
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
      },
    ]),
  );

  const { data: primaryVoteRows } = await supabase.from("primary_votes").select("candidate_id").eq("election_id", id);
  const primaryTally: Record<string, number> = {};
  for (const row of primaryVoteRows ?? []) {
    const cid = row.candidate_id as string;
    primaryTally[cid] = (primaryTally[cid] ?? 0) + 1;
  }

  const { data: generalVoteRows } = await supabase
    .from("general_votes")
    .select("candidate_id")
    .eq("election_id", id);
  const generalTally: Record<string, number> = {};
  for (const row of generalVoteRows ?? []) {
    const cid = row.candidate_id as string;
    generalTally[cid] = (generalTally[cid] ?? 0) + 1;
  }

  const { data: myPrimaryVote } = await supabase
    .from("primary_votes")
    .select("candidate_id")
    .eq("election_id", id)
    .eq("voter_id", user.id)
    .maybeSingle();

  const { data: myGeneralVote } = await supabase
    .from("general_votes")
    .select("candidate_id")
    .eq("election_id", id)
    .eq("voter_id", user.id)
    .maybeSingle();

  const { data: myProfile } = await supabase
    .from("profiles")
    .select("party, residence_state, home_district_code")
    .eq("id", user.id)
    .maybeSingle();

  const activeSlots = await loadActiveCandidacySlots(supabase, user.id);

  // Partisan lean (house uses district pvi; senate uses state pvi; president is per-state but we expose
  // it as 0 at the race level).
  let partisanLean = 0;
  if (election.office === "house" && election.district_code) {
    const { data: d } = await supabase
      .from("districts")
      .select("pvi")
      .eq("code", election.district_code)
      .maybeSingle();
    partisanLean = Number(d?.pvi ?? 0);
  } else if (election.office === "senate" && election.state) {
    const { data: s } = await supabase
      .from("states")
      .select("pvi")
      .eq("code", election.state)
      .maybeSingle();
    partisanLean = Number(s?.pvi ?? 0);
  }

  // Per-candidate activity rollups so the UI can show "3 speeches · 6 rallies".
  const speechCountBy: Record<string, number> = {};
  const rallyCountBy: Record<string, number> = {};
  let myRalliesInWindow = 0;
  if (candList.length) {
    const { data: speechRows } = await supabase
      .from("campaign_speeches")
      .select("candidate_id")
      .eq("election_id", id);
    for (const row of speechRows ?? []) {
      const cid = row.candidate_id as string;
      speechCountBy[cid] = (speechCountBy[cid] ?? 0) + 1;
    }
    const { data: rallyRows } = await supabase
      .from("campaign_rallies")
      .select("candidate_id")
      .eq("election_id", id);
    for (const row of rallyRows ?? []) {
      const cid = row.candidate_id as string;
      rallyCountBy[cid] = (rallyCountBy[cid] ?? 0) + 1;
    }
    const myCand = candList.find((c) => c.user_id === user.id);
    if (myCand) {
      const windowStart = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("campaign_rallies")
        .select("id", { count: "exact", head: true })
        .eq("election_id", id)
        .eq("candidate_id", myCand.id)
        .gte("created_at", windowStart);
      myRalliesInWindow = count ?? 0;
    }
  }

  // State list for presidential speech/rally targeting.
  const { data: states } = await supabase.from("states").select("code, name").order("code");

  let winnerName: string | null = null;
  if (election.winner_user_id) {
    const { data: wp } = await supabase
      .from("profiles")
      .select("character_name")
      .eq("id", election.winner_user_id)
      .maybeSingle();
    winnerName = wp?.character_name ?? null;
  }

  const isAdmin = await getIsAdmin();

  return (
    <div className="space-y-6">
      <Link href="/elections" className="text-sm font-semibold text-[var(--psc-accent)]">
        ← All elections
      </Link>
      <ElectionDetail
        election={election}
        candidates={candList.map((c) => ({
          ...c,
          primary_winner: c.primary_winner ?? false,
          campaign_points_total: c.campaign_points_total,
          created_at: c.created_at ?? null,
        }))}
        nameBy={nameBy}
        candidateCardByUserId={candidateCardByUserId}
        primaryTally={primaryTally}
        generalTally={generalTally}
        myPrimaryCandidateId={myPrimaryVote?.candidate_id ?? null}
        myGeneralCandidateId={myGeneralVote?.candidate_id ?? null}
        profileParty={myProfile?.party ?? null}
        profileForFiling={
          myProfile
            ? {
                party: myProfile.party,
                residence_state: myProfile.residence_state,
                home_district_code: myProfile.home_district_code,
              }
            : null
        }
        activeSlots={activeSlots}
        userId={user.id}
        isAdmin={isAdmin}
        winnerName={winnerName}
        partisanLean={partisanLean}
        speechCountBy={speechCountBy}
        rallyCountBy={rallyCountBy}
        myRalliesInWindow={myRalliesInWindow}
        states={(states ?? []) as Array<{ code: string; name: string }>}
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
