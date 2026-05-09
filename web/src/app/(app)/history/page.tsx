import Link from "next/link";
import { redirect } from "next/navigation";
import { addHallOfFameEntry, removeHallOfFameEntry } from "@/app/actions/history";
import { ProfileImageWithFallback } from "@/components/profile-image-with-fallback";
import { profileImageSrc, profilePath } from "@/components/profile-card";
import { ProfileTypeaheadInput } from "@/components/profile-typeahead-input";
import { getIsAdmin } from "@/lib/is-admin";
import { computeSimulationRpInstant, type SimulationSettingsRow } from "@/lib/simulation-calendar";
import { getServerAuth } from "@/lib/supabase/server";

type ProfileLite = {
  id: string;
  character_name: string | null;
  discord_username: string | null;
  party: string | null;
  residence_state: string | null;
  home_district_code: string | null;
  date_of_birth: string | null;
  bio: string | null;
  former_positions: string | null;
  face_claim_url: string | null;
};

type LeaderTermCard = {
  key: string;
  rankNumber: number;
  roleLabel: string;
  userId: string;
  name: string;
  image: string | null;
  party: string;
  state: string;
  termStart: string | null;
  termEnd: string | null;
  runningMate: string | null;
  notableAchievements: string[];
  dateOfBirth: string | null;
  relevantInfo: string | null;
};

function partyNameColorClass(partyLabelText: string): string {
  const p = partyLabelText.toLowerCase();
  if (p.includes("democratic")) return "text-blue-700";
  if (p.includes("republican")) return "text-red-700";
  if (p.includes("independent")) return "text-amber-700";
  return "text-[var(--psc-ink)]";
}

function isMissingHallOfFameSchema(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("hall_of_fame_entries") || m.includes("schema cache");
}

function ordinal(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return `${n}st`;
  if (j === 2 && k !== 12) return `${n}nd`;
  if (j === 3 && k !== 13) return `${n}rd`;
  return `${n}th`;
}

function partyLabel(p: string | null | undefined) {
  const v = String(p ?? "").toLowerCase();
  if (v === "democrat") return "Democratic";
  if (v === "republican") return "Republican";
  if (v === "independent") return "Independent";
  return "Unaffiliated";
}

function stateLabel(residenceState: string | null | undefined, district: string | null | undefined) {
  const s = String(residenceState ?? "").trim().toUpperCase();
  if (s) return s;
  const d = String(district ?? "").trim().toUpperCase();
  if (d.length >= 2) return d.slice(0, 2);
  return "—";
}

function dateLabel(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function rpDateLabel(settings: SimulationSettingsRow | null, iso: string | null) {
  if (!settings) return dateLabel(iso);
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const rp = computeSimulationRpInstant(settings, d);
  return rp.at.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function byEarliestFile<T extends { created_at?: string | null; id?: string | null }>(a: T, b: T): number {
  const at = a.created_at ? new Date(a.created_at).getTime() : Number.MAX_SAFE_INTEGER;
  const bt = b.created_at ? new Date(b.created_at).getTime() : Number.MAX_SAFE_INTEGER;
  if (at !== bt) return at - bt;
  return String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

function renderLeaderCards(cards: LeaderTermCard[], emptyText: string, simulationSettings: SimulationSettingsRow | null) {
  if (!cards.length) {
    return <p className="text-sm text-[var(--psc-muted)]">{emptyText}</p>;
  }
  return (
    <ol className="space-y-4">
      {cards.map((card) => (
        <li key={card.key} className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-4">
          <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded border border-[var(--psc-border)] bg-white">
              <ProfileImageWithFallback
                src={card.image}
                name={card.name}
                className="h-full w-full object-cover"
                initialClassName="flex h-80 w-full items-center justify-center text-4xl font-semibold text-[var(--psc-muted)]"
              />
            </div>
            <div className="space-y-2">
              <h3 className={`text-4xl font-semibold tracking-tight ${partyNameColorClass(card.party)}`}>{card.name}</h3>
              <p className="text-sm text-[var(--psc-muted)]">
                {rpDateLabel(simulationSettings, card.termStart)}
                {card.termEnd ? ` - ${rpDateLabel(simulationSettings, card.termEnd)}` : " - Present"}, {card.party} Party
              </p>
              <div className="space-y-1 text-sm text-[var(--psc-ink)]">
                <p>
                  <strong>{ordinal(card.rankNumber)} {card.roleLabel}</strong>
                </p>
                <p>
                  <strong>Date of Birth:</strong> {dateLabel(card.dateOfBirth)}
                </p>
                <p>
                  <strong>Term:</strong> {rpDateLabel(simulationSettings, card.termStart)} -{" "}
                  {card.termEnd ? rpDateLabel(simulationSettings, card.termEnd) : "Present"}
                </p>
                {card.runningMate ? (
                  <p>
                    <strong>Running Mate:</strong> {card.runningMate}
                  </p>
                ) : null}
                <p>
                  <strong>Party:</strong> {card.party}
                </p>
                <p>
                  <strong>State:</strong> {card.state}
                </p>
                <div>
                  <strong>Notable Achievements:</strong>
                  <ul className="ml-5 mt-1 list-disc">
                    {card.notableAchievements.map((n, i) => (
                      <li key={`${card.key}-n-${i}`}>{n}</li>
                    ))}
                  </ul>
                </div>
                {card.relevantInfo?.trim() ? (
                  <p>
                    <strong>Relevant Information:</strong> {card.relevantInfo}
                  </p>
                ) : null}
                <p>
                  <Link
                    href={profilePath(card.userId) ?? "/directory"}
                    className="text-xs font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline"
                  >
                    Open profile
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default async function HistoryPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to load the Hall of Fame archive.
      </div>
    );
  }
  if (!user) redirect("/login");
  const isAdmin = await getIsAdmin();

  const [presElectionRes, leadershipSessionRes, hofRes, simSettingsRes] = await Promise.all([
    supabase
      .from("elections")
      .select("id, winner_user_id, general_closes_at, created_at")
      .eq("office", "president")
      .eq("phase", "closed")
      .not("winner_user_id", "is", null)
      .order("general_closes_at", { ascending: true }),
    supabase
      .from("leadership_sessions")
      .select("id, chamber, closes_at, closed_at")
      .eq("phase", "closed")
      .order("closed_at", { ascending: true, nullsFirst: false }),
    supabase
      .from("hall_of_fame_entries")
      .select("id, user_id, honor_title, note")
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    supabase.from("simulation_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  const hallOfFameSchemaMissing = Boolean(hofRes.error && isMissingHallOfFameSchema(hofRes.error.message));
  const simulationSettings =
    simSettingsRes.error || !simSettingsRes.data ? null : (simSettingsRes.data as SimulationSettingsRow);

  const presidentialTermsRaw = (presElectionRes.data ?? []) as Array<{
    id: string;
    winner_user_id: string | null;
    general_closes_at: string | null;
    created_at: string;
  }>;
  const leadershipSessions = (leadershipSessionRes.data ?? []) as Array<{
    id: string;
    chamber: "house" | "senate";
    closes_at: string;
    closed_at: string | null;
  }>;
  const hofEntries = (hofRes.data ?? []) as Array<{
    id: string;
    user_id: string;
    honor_title: string;
    note: string | null;
  }>;

  const presElectionIds = presidentialTermsRaw.map((r) => r.id);
  const leadershipSessionIds = leadershipSessions.map((s) => s.id);

  const [presCandidateRowsRes, leadershipCandidatesRes, leadershipVotesRes] = await Promise.all([
    presElectionIds.length
      ? supabase
          .from("election_candidates")
          .select("id, election_id, user_id, running_mate_user_id")
          .in("election_id", presElectionIds)
      : Promise.resolve({ data: [] as never[] }),
    leadershipSessionIds.length
      ? supabase
          .from("leadership_session_candidates")
          .select("id, session_id, role, user_id, created_at")
          .in("session_id", leadershipSessionIds)
      : Promise.resolve({ data: [] as never[] }),
    leadershipSessionIds.length
      ? supabase
          .from("leadership_session_votes")
          .select("session_id, role, candidate_id")
          .in("session_id", leadershipSessionIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const presCandidateRows = (presCandidateRowsRes.data ?? []) as Array<{
    id: string;
    election_id: string;
    user_id: string;
    running_mate_user_id: string | null;
  }>;
  const leadershipCandidates = (leadershipCandidatesRes.data ?? []) as Array<{
    id: string;
    session_id: string;
    role: string;
    user_id: string;
    created_at: string;
  }>;
  const leadershipVotes = (leadershipVotesRes.data ?? []) as Array<{
    session_id: string;
    role: string;
    candidate_id: string;
  }>;

  const neededProfileIds = new Set<string>();
  for (const t of presidentialTermsRaw) if (t.winner_user_id) neededProfileIds.add(t.winner_user_id);
  for (const c of presCandidateRows) if (c.running_mate_user_id) neededProfileIds.add(c.running_mate_user_id);
  for (const c of leadershipCandidates) neededProfileIds.add(c.user_id);
  for (const h of hofEntries) neededProfileIds.add(h.user_id);
  const profileIds = [...neededProfileIds];

  const [profilesRes, lawsRes, grantsRes] = await Promise.all([
    profileIds.length
      ? supabase
          .from("profiles")
          .select(
            "id, character_name, discord_username, party, residence_state, home_district_code, date_of_birth, bio, former_positions, face_claim_url",
          )
          .in("id", profileIds)
      : Promise.resolve({ data: [] as never[] }),
    profileIds.length
      ? supabase.from("bills").select("author_id").eq("status", "law").in("author_id", profileIds)
      : Promise.resolve({ data: [] as never[] }),
    profileIds.length
      ? supabase
          .from("government_role_grants")
          .select("user_id, role_key")
          .in("user_id", profileIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const profiles = (profilesRes.data ?? []) as ProfileLite[];
  const profileById = new Map(profiles.map((p) => [p.id, p] as const));
  const lawsByAuthor = new Map<string, number>();
  for (const row of (lawsRes.data ?? []) as Array<{ author_id: string }>) {
    lawsByAuthor.set(row.author_id, (lawsByAuthor.get(row.author_id) ?? 0) + 1);
  }
  const roleHoldersByRole = new Map<string, Set<string>>();
  for (const row of (grantsRes.data ?? []) as Array<{ user_id: string; role_key: string }>) {
    const set = roleHoldersByRole.get(row.role_key) ?? new Set<string>();
    set.add(row.user_id);
    roleHoldersByRole.set(row.role_key, set);
  }

  const candidateByElectionAndWinner = new Map<string, { runningMateUserId: string | null }>();
  for (const row of presCandidateRows) {
    candidateByElectionAndWinner.set(`${row.election_id}:${row.user_id}`, {
      runningMateUserId: row.running_mate_user_id ?? null,
    });
  }

  const presidentialTerms: LeaderTermCard[] = presidentialTermsRaw.map((row, idx, arr) => {
    const userId = String(row.winner_user_id);
    const profile = profileById.get(userId);
    const name = profile?.character_name?.trim() || profile?.discord_username?.trim() || `User ${userId.slice(0, 8)}`;
    const start = row.general_closes_at ?? row.created_at;
    const nextStart = idx + 1 < arr.length ? arr[idx + 1]!.general_closes_at ?? arr[idx + 1]!.created_at : null;
    const candidateKey = `${row.id}:${userId}`;
    const runningMateId = candidateByElectionAndWinner.get(candidateKey)?.runningMateUserId ?? null;
    const runningMate = runningMateId
      ? profileById.get(runningMateId)?.character_name?.trim() ||
        profileById.get(runningMateId)?.discord_username?.trim() ||
        `User ${runningMateId.slice(0, 8)}`
      : null;
    const laws = lawsByAuthor.get(userId) ?? 0;
    const achievements = [`${laws} law${laws === 1 ? "" : "s"} enacted`];
    if (roleHoldersByRole.get("president")?.has(userId)) achievements.push("Currently serving");
    return {
      key: `pres-${row.id}`,
      rankNumber: idx + 1,
      roleLabel: "President of Imperium",
      userId,
      name,
      image: profileImageSrc(profile?.face_claim_url),
      party: partyLabel(profile?.party),
      state: stateLabel(profile?.residence_state, profile?.home_district_code),
      termStart: start,
      termEnd: nextStart,
      runningMate,
      notableAchievements: achievements,
      dateOfBirth: profile?.date_of_birth ?? null,
      relevantInfo: profile?.former_positions ?? profile?.bio ?? null,
    };
  });

  const candidateById = new Map(leadershipCandidates.map((c) => [c.id, c] as const));
  const voteCountByCandidate = new Map<string, number>();
  for (const v of leadershipVotes) {
    voteCountByCandidate.set(v.candidate_id, (voteCountByCandidate.get(v.candidate_id) ?? 0) + 1);
  }

  function buildLeadershipTerms(roleKey: "speaker" | "senate_majority_leader", roleLabel: string): LeaderTermCard[] {
    const matchingSessions = leadershipSessions.filter((s) => (roleKey === "speaker" ? s.chamber === "house" : s.chamber === "senate"));
    const termWinners: Array<{ sessionId: string; userId: string; at: string }> = [];
    for (const s of matchingSessions) {
      const roleCandidates = leadershipCandidates
        .filter((c) => c.session_id === s.id && c.role === roleKey)
        .sort(byEarliestFile);
      if (!roleCandidates.length) continue;
      let winner = roleCandidates[0]!;
      let bestVotes = voteCountByCandidate.get(winner.id) ?? 0;
      for (const cand of roleCandidates.slice(1)) {
        const votes = voteCountByCandidate.get(cand.id) ?? 0;
        if (votes > bestVotes) {
          winner = cand;
          bestVotes = votes;
          continue;
        }
        if (votes === bestVotes && byEarliestFile(cand, winner) < 0) {
          winner = cand;
        }
      }
      termWinners.push({
        sessionId: s.id,
        userId: winner.user_id,
        at: s.closed_at ?? s.closes_at,
      });
    }

    return termWinners.map((t, idx, arr) => {
      const p = profileById.get(t.userId);
      const name = p?.character_name?.trim() || p?.discord_username?.trim() || `User ${t.userId.slice(0, 8)}`;
      const laws = lawsByAuthor.get(t.userId) ?? 0;
      const votesWon = leadershipVotes.filter((v) => {
        const cand = candidateById.get(v.candidate_id);
        return cand?.session_id === t.sessionId && cand.role === roleKey && cand.user_id === t.userId;
      }).length;
      const nextAt = idx + 1 < arr.length ? arr[idx + 1]!.at : null;
      return {
        key: `${roleKey}-${t.sessionId}`,
        rankNumber: idx + 1,
        roleLabel,
        userId: t.userId,
        name,
        image: profileImageSrc(p?.face_claim_url),
        party: partyLabel(p?.party),
        state: stateLabel(p?.residence_state, p?.home_district_code),
        termStart: t.at,
        termEnd: nextAt,
        runningMate: null,
        notableAchievements: [`Won with ${votesWon} vote(s)`, `${laws} law${laws === 1 ? "" : "s"} enacted`],
        dateOfBirth: p?.date_of_birth ?? null,
        relevantInfo: p?.former_positions ?? p?.bio ?? null,
      };
    });
  }

  const speakerHistory = buildLeadershipTerms("speaker", "Speaker of the House");
  const senateMajorityLeaderHistory = buildLeadershipTerms("senate_majority_leader", "Senate Majority Leader");

  const hallOfFameCards = hofEntries
    .map((entry) => {
      const p = profileById.get(entry.user_id);
      if (!p) return null;
      const name = p.character_name?.trim() || p.discord_username?.trim() || `User ${entry.user_id.slice(0, 8)}`;
      return {
        entry,
        name,
        image: profileImageSrc(p.face_claim_url),
        subtitle: `${partyLabel(p.party)} • ${stateLabel(p.residence_state, p.home_district_code)}`,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-7 text-center shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--psc-muted)]">Imperium Archives</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--psc-ink)]">Hall of Fame</h1>
      </section>

      <section className="space-y-4 rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-center text-xl font-semibold text-[var(--psc-ink)]">Hall of Fame</h2>
        {hallOfFameSchemaMissing ? (
          <div className="rounded border border-amber-700 bg-amber-50 p-3 text-xs text-amber-900">
            Hall of Fame table is not in this database yet. Run
            <code className="mx-1 font-mono">supabase/migrations/20260473180000_hall_of_fame_admin_entries.sql</code>
            then
            <code className="mx-1 font-mono">notify pgrst, &apos;reload schema&apos;;</code>.
          </div>
        ) : null}
        {hallOfFameCards.length === 0 ? (
          <p className="text-sm text-[var(--psc-muted)]">No Hall of Fame entries yet.</p>
        ) : (
          <div className="space-y-4">
            {hallOfFameCards.map(({ entry, name, image, subtitle }) => (
              <article
                key={entry.id}
                className="rounded-xl border-[3px] border-amber-400 bg-[var(--psc-panel)] p-4 shadow-sm ring-1 ring-inset ring-amber-200"
              >
                <div className="flex flex-wrap items-center gap-4">
                  <div className="h-20 w-20 overflow-hidden rounded border border-amber-500 bg-white">
                    <ProfileImageWithFallback
                      src={image}
                      name={name}
                      className="h-full w-full object-cover"
                      initialClassName="flex h-full w-full items-center justify-center text-xl font-semibold text-[var(--psc-muted)]"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">{entry.honor_title}</p>
                    <h3 className={`truncate text-xl font-semibold ${partyNameColorClass(subtitle)}`}>{name}</h3>
                    <p className="text-sm text-[var(--psc-muted)]">{subtitle}</p>
                    {entry.note?.trim() ? <p className="mt-1 text-sm text-[var(--psc-ink)]">{entry.note}</p> : null}
                  </div>
                  <Link
                    href={profilePath(entry.user_id) ?? "/directory"}
                    className="text-xs font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline"
                  >
                    Open profile
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}

        {isAdmin && !hallOfFameSchemaMissing ? (
          <div className="space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-4">
            <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Admin controls</h3>
            <form action={addHallOfFameEntry} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <ProfileTypeaheadInput hiddenName="user_id" required placeholder="Type character name…" />
              <input
                name="honor_title"
                placeholder="Honor title"
                className="rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-sm"
              />
              <input
                name="note"
                placeholder="Short note"
                className="rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-sm"
              />
              <button
                type="submit"
                className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-1.5 text-xs font-semibold uppercase text-white"
              >
                Add
              </button>
            </form>
            {hofEntries.length ? (
              <div className="space-y-1 text-xs">
                {hofEntries.map((entry) => (
                  <form key={entry.id} action={removeHallOfFameEntry} className="flex items-center justify-between gap-2">
                    <input type="hidden" name="entry_id" value={entry.id} />
                    <span className="truncate text-[var(--psc-muted)]">
                      {entry.honor_title} — {entry.user_id}
                    </span>
                    <button type="submit" className="text-red-700 underline">
                      Remove
                    </button>
                  </form>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-4 rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-xl font-semibold text-[var(--psc-ink)]">Presidential History</h2>
        <div className="max-h-[44rem] overflow-y-auto pr-2">
          {renderLeaderCards(presidentialTerms, "No closed presidential races yet.", simulationSettings)}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-xl font-semibold text-[var(--psc-ink)]">Speaker History</h2>
        <div className="max-h-[44rem] overflow-y-auto pr-2">
          {renderLeaderCards(speakerHistory, "No closed Speaker leadership sessions yet.", simulationSettings)}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-xl font-semibold text-[var(--psc-ink)]">Senate Majority Leader History</h2>
        <div className="max-h-[44rem] overflow-y-auto pr-2">
          {renderLeaderCards(senateMajorityLeaderHistory, "No closed Senate Majority Leader sessions yet.", simulationSettings)}
        </div>
      </section>
    </div>
  );
}
