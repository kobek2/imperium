import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";
import {
  computeSimulationRpInstant,
  defaultSimulationSettingsForDisplay,
  healSimulationClockDrift,
  type SimulationSettingsRow,
} from "@/lib/simulation-calendar";
import type { ProfileCardData } from "@/components/profile-card";
import { PartyRoom } from "./party-room";

const VALID = new Set(["democrat", "republican"]);

function partyElectionSlotLabel(e: {
  office: string;
  district_code: string | null;
  state: string | null;
  leadership_role: string | null;
}): string {
  if (e.leadership_role) return `Leadership · ${e.leadership_role}`;
  if (e.office === "house") return `House ${e.district_code ?? ""}`;
  if (e.office === "senate") return `Senate ${e.state ?? ""}`;
  return "President";
}

export default async function PartyDetailPage({ params }: { params: Promise<{ party: string }> }) {
  const { party: raw } = await params;
  const partyKey = raw.toLowerCase();
  if (!VALID.has(partyKey)) notFound();

  const supabase = await tryCreateClient();
  if (!supabase) redirect("/");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase.rpc("party_tick_leadership_cycle", { p_party: partyKey });

  const [
    { data: org },
    { data: officers },
    { data: cands },
    { data: votes },
    { data: members },
    { data: simRow },
    isAdmin,
    { data: viewerProfile },
    { data: myVoteRows },
  ] = await Promise.all([
    supabase
      .from("party_organizations")
      .select(
        "treasury_balance, leadership_phase, leadership_filing_ends_at, leadership_voting_ends_at, next_leadership_election_opens_at, next_leadership_election_opens_on_rp, last_leadership_cycle_completed_at",
      )
      .eq("party_key", partyKey)
      .maybeSingle(),
    supabase.from("party_officers").select("party_key, office, user_id, since").eq("party_key", partyKey),
    supabase.from("party_officer_candidacies").select("user_id, office").eq("party_key", partyKey),
    supabase.from("party_officer_votes").select("office, candidate_id").eq("party_key", partyKey),
    supabase
      .from("profiles")
      .select("id, character_name, office_role, home_district_code")
      .eq("party", partyKey)
      .order("character_name", { ascending: true }),
    supabase.from("simulation_settings").select("*").eq("id", 1).maybeSingle(),
    getIsAdmin(),
    supabase.from("profiles").select("party").eq("id", user.id).maybeSingle(),
    supabase.from("party_officer_votes").select("office, candidate_id").eq("party_key", partyKey).eq("voter_id", user.id),
  ]);

  const simSettings: SimulationSettingsRow = simRow
    ? healSimulationClockDrift(simRow as SimulationSettingsRow).displaySettings
    : defaultSimulationSettingsForDisplay();
  const rpInstant = computeSimulationRpInstant(simSettings);
  const rpCalendarDay = rpInstant.at.toISOString().slice(0, 10);
  const leadershipPhase = (org?.leadership_phase as string | null) ?? "idle";
  const nextOpensRp = (org?.next_leadership_election_opens_on_rp as string | null) ?? null;
  const leadershipOpenOverdue =
    leadershipPhase === "idle" && Boolean(nextOpensRp) && rpCalendarDay >= String(nextOpensRp).slice(0, 10);

  const candUserIds = [...new Set((cands ?? []).map((c) => c.user_id as string))];
  const officerHolderIds = (officers ?? [])
    .map((o) => o.user_id as string | null)
    .filter((x): x is string => Boolean(x));
  const allNameIds = [...new Set([...candUserIds, ...officerHolderIds])];
  const { data: profiles } =
    allNameIds.length > 0
      ? await supabase.from("profiles").select("id, character_name").in("id", allNameIds)
      : { data: [] as const };

  const nameMap = new Map<string, string | null>();
  for (const p of profiles ?? []) nameMap.set(p.id as string, p.character_name as string | null);

  const { data: cardProfiles } =
    candUserIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, character_name, face_claim_url, party, bio, residence_state, home_district_code")
          .in("id", candUserIds)
      : { data: [] as const };

  type OfficeKey = "chair" | "vice_chair" | "treasurer";
  const myVoteByOffice: Partial<Record<OfficeKey, string>> = {};
  for (const row of myVoteRows ?? []) {
    const o = (row as { office: string }).office;
    if (o === "chair" || o === "vice_chair" || o === "treasurer") {
      myVoteByOffice[o] = (row as { candidate_id: string }).candidate_id;
    }
  }

  const profileById: Record<string, ProfileCardData> = {};
  for (const p of cardProfiles ?? []) {
    const id = p.id as string;
    profileById[id] = {
      id,
      character_name: p.character_name as string | null,
      face_claim_url: p.face_claim_url as string | null,
      party: (p.party as string | null) ?? partyKey,
      bio: p.bio as string | null,
      residence_state: p.residence_state as string | null,
      home_district_code: p.home_district_code as string | null,
    };
  }

  const viewerMayRun = (viewerProfile?.party as string | null | undefined) === partyKey;

  const candidatesByOffice: Record<string, Array<{ user_id: string; character_name: string | null }>> = {
    chair: [],
    vice_chair: [],
    treasurer: [],
  };
  for (const row of cands ?? []) {
    const r = row as { office: string; user_id: string };
    const list = candidatesByOffice[r.office];
    if (list) {
      list.push({
        user_id: r.user_id,
        character_name: nameMap.get(r.user_id) ?? null,
      });
    }
  }

  const { data: partyCandRows } = await supabase.from("election_candidates").select("election_id").eq("party", partyKey);
  const fundElectionIds = [...new Set((partyCandRows ?? []).map((r) => r.election_id as string))];
  const { data: fundElectionRows } =
    fundElectionIds.length > 0
      ? await supabase
          .from("elections")
          .select("id, office, state, district_code, senate_class, phase, leadership_role")
          .in("id", fundElectionIds)
          .neq("phase", "closed")
      : { data: [] as const };

  const fundableElections = (fundElectionRows ?? [])
    .map((row) => {
      const e = row as {
        id: string;
        office: string;
        state: string | null;
        district_code: string | null;
        phase: string;
        leadership_role: string | null;
      };
      return {
        id: e.id,
        phase: e.phase,
        label: `${partyElectionSlotLabel(e)} · ${e.phase}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const chairOrTreasurer = (officers ?? []).filter(
    (o) => o.office === "chair" || o.office === "treasurer",
  ) as Array<{ office: string; user_id: string | null }>;
  const canFundTreasury = chairOrTreasurer.some((o) => o.user_id === user.id);

  const partyTitle =
    partyKey === "democrat" ? "Democratic Party" : partyKey === "republican" ? "Republican Party" : "Independent";

  return (
    <div className="space-y-6">
      <nav className="text-sm">
        <Link href="/parties" className="font-semibold text-[var(--psc-accent)] underline">
          ← All parties
        </Link>
      </nav>
      <header>
        <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">{partyTitle}</h1>
      </header>
      <PartyRoom
        partyKey={partyKey}
        treasury={Number(org?.treasury_balance ?? 0)}
        leadershipPhase={leadershipPhase}
        leadershipElectionEndsAt={(org?.leadership_filing_ends_at as string | null) ?? null}
        nextLeadershipOpensOnRp={nextOpensRp}
        rpCalendarLabel={rpInstant.label}
        leadershipOpenOverdue={leadershipOpenOverdue}
        lastLeadershipCompletedAt={(org?.last_leadership_cycle_completed_at as string | null) ?? null}
        officers={(officers ?? []) as Array<{ party_key: string; office: string; user_id: string | null; since: string }>}
        nameById={Object.fromEntries(nameMap)}
        voteRows={(votes ?? []) as Array<{ office: string; candidate_id: string }>}
        candidatesByOffice={candidatesByOffice}
        profileById={profileById}
        myVoteByOffice={myVoteByOffice}
        viewerId={user.id}
        viewerMayRun={viewerMayRun}
        members={(members ?? []) as Array<{
          id: string;
          character_name: string;
          office_role: string | null;
          home_district_code: string | null;
        }>}
        fundableElections={fundableElections}
        canFundTreasury={canFundTreasury}
        isAdmin={isAdmin}
      />
    </div>
  );
}
