import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/server";
import { getStaffMayManagePartyOrg } from "@/lib/staff-access";
import {
  computeSimulationRpInstant,
  defaultSimulationSettingsForDisplay,
  healSimulationClockDrift,
  type SimulationSettingsRow,
} from "@/lib/simulation-calendar";
import type { ProfileCardData } from "@/components/profile-card";
import { PartyRoom } from "./party-room";

const VALID = new Set(["democrat", "republican"]);

export default async function PartyDetailPage({ params }: { params: Promise<{ party: string }> }) {
  const { party: raw } = await params;
  const partyKey = raw.toLowerCase();
  if (!VALID.has(partyKey)) notFound();

  const { supabase, user } = await getServerAuth();
  if (!supabase) redirect("/");

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
    { data: boardSelf },
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
      .select("id, character_name, home_district_code")
      .eq("party", partyKey)
      .order("character_name", { ascending: true }),
    supabase.from("simulation_settings").select("*").eq("id", 1).maybeSingle(),
    getStaffMayManagePartyOrg(),
    supabase.from("profiles").select("party").eq("id", user.id).maybeSingle(),
    supabase.from("party_officer_votes").select("office, candidate_id").eq("party_key", partyKey).eq("voter_id", user.id),
    supabase.from("party_national_board_members").select("user_id").eq("party_key", partyKey).eq("user_id", user.id).maybeSingle(),
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
    allNameIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, character_name, face_claim_url, party, bio, residence_state, home_district_code")
          .in("id", allNameIds)
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

  const memberIds = (members ?? []).map((m) => m.id as string);
  const { data: memberWallets, error: memberWalletsError } =
    memberIds.length > 0
      ? await supabase.from("economy_wallets").select("user_id, balance").in("user_id", memberIds)
      : { data: [] as const, error: null };
  const balanceByMemberId = new Map<string, number>();
  if (!memberWalletsError && memberWallets) {
    for (const w of memberWallets) {
      balanceByMemberId.set(w.user_id as string, Number((w as { balance: number }).balance));
    }
  }

  const membersForRoom = (members ?? []).map((m) => ({
    id: m.id as string,
    character_name: String((m as { character_name: string }).character_name ?? ""),
    home_district_code: (m as { home_district_code: string | null }).home_district_code ?? null,
    wallet_balance: balanceByMemberId.get(m.id as string) ?? 0,
  }));

  const chairOrTreasurer = (officers ?? []).filter(
    (o) => o.office === "chair" || o.office === "treasurer",
  ) as Array<{ office: string; user_id: string | null }>;
  const canFundTreasury = chairOrTreasurer.some((o) => o.user_id === user.id);

  const isPartyOfficer = (officers ?? []).some(
    (o) =>
      o.user_id === user.id && (o.office === "chair" || o.office === "vice_chair" || o.office === "treasurer"),
  );
  const showLeadershipDashboardLink = isPartyOfficer || Boolean(boardSelf);

  const partyTitle =
    partyKey === "democrat" ? "Democratic Party" : partyKey === "republican" ? "Republican Party" : "Independent";

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-4 text-sm">
        <Link href="/parties" className="font-semibold text-[var(--psc-accent)] underline">
          ← All parties
        </Link>
        {showLeadershipDashboardLink ? (
          <Link href={`/parties/${partyKey}/leadership`} className="font-semibold text-[var(--psc-accent)] underline">
            Leadership dashboard
          </Link>
        ) : null}
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
        members={membersForRoom}
        canFundTreasury={canFundTreasury}
        isAdmin={isAdmin}
      />
    </div>
  );
}
