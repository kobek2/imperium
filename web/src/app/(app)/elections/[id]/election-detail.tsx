import Link from "next/link";
import { ProfileCard, ProfileCardBadge, profilePath } from "@/components/profile-card";
import { SubmitButton } from "@/components/submit-button";
import {
  castGeneralVote,
  castPrimaryVote,
  fileCandidacy,
} from "@/app/actions/elections";
import { districtLeanBonus } from "@/lib/fec";
import type { LeadershipRole } from "@/lib/leadership";
import { RallyForm } from "./rally-form";
import { SpeechForm } from "./speech-form";

type ElectionRow = {
  id: string;
  office: string;
  state: string | null;
  district_code: string | null;
  phase: string;
  filing_opens_at: string;
  filing_closes_at: string;
  primary_closes_at: string | null;
  general_closes_at: string;
  winner_user_id: string | null;
  primary_party_wide?: boolean | null;
  leadership_role?: string | null;
  restricted_party?: string | null;
};

type LeadershipMeta = {
  role: LeadershipRole;
  label: string;
  restricted_party: "democrat" | "republican" | "independent" | null;
};

type CandRow = {
  id: string;
  user_id: string;
  party: string;
  campaign_points_total: number | null;
  primary_winner: boolean | null;
  created_at?: string | null;
};

type CandidateCardFields = {
  character_name: string | null;
  face_claim_url: string | null;
  residence_state: string | null;
  home_district_code: string | null;
  bio: string | null;
};

type PartyKey = "democrat" | "republican" | "independent";
const PARTY_ORDER: PartyKey[] = ["democrat", "republican", "independent"];

function partyMeta(p: string) {
  switch (p) {
    case "democrat":
      return {
        label: "Democratic",
        pill: "bg-blue-600 text-white border-blue-700",
        accent: "border-blue-300",
        cardBg: "bg-blue-50",
        cardBorder: "border-blue-400",
      };
    case "republican":
      return {
        label: "Republican",
        pill: "bg-red-600 text-white border-red-700",
        accent: "border-red-300",
        cardBg: "bg-red-50",
        cardBorder: "border-red-400",
      };
    case "independent":
      return {
        label: "Independent",
        pill: "bg-slate-700 text-white border-slate-800",
        accent: "border-slate-300",
        cardBg: "bg-slate-50",
        cardBorder: "border-slate-400",
      };
    default:
      return {
        label: p || "Unaffiliated",
        pill: "bg-slate-200 text-slate-900 border-slate-300",
        accent: "border-slate-200",
        cardBg: "bg-[var(--psc-panel)]",
        cardBorder: "border-[var(--psc-border)]",
      };
  }
}

function displayName(card: CandidateCardFields | undefined, userId: string, nameBy: Record<string, string>) {
  const n = card?.character_name?.trim() || nameBy[userId]?.trim();
  return n || userId.slice(0, 8);
}

type VoteMode = "none" | "primary" | "general";

/**
 * A single candidate tile. We show a single percentage — either their primary vote share or
 * their blended general score — instead of the old "Primary: 8 · General: 10 · Speeches: 3…"
 * list. Campaign-activity rollups live in the candidate's own <CampaignPanel/> section.
 */
function CandidateCard({
  cand,
  card,
  name,
  isYou,
  isWinner,
  isLeader,
  share,
  shareLabel,
  selected,
  mode,
  electionId,
  disabled,
  emphasizeParty,
}: {
  cand: CandRow;
  card: CandidateCardFields | undefined;
  name: string;
  isYou: boolean;
  isWinner: boolean;
  isLeader: boolean;
  /** Vote/score share from 0 to 1, or null if there's nothing to show. */
  share: number | null;
  /** Shown under the percentage (e.g. "8 votes" or "projected score"). */
  shareLabel: string | null;
  selected: boolean;
  mode: VoteMode;
  electionId: string;
  disabled: boolean;
  emphasizeParty: boolean;
}) {
  const badges = (
    <>
      {isYou ? <ProfileCardBadge tone="you">You</ProfileCardBadge> : null}
      {cand.primary_winner ? <ProfileCardBadge tone="nominee">Nominee</ProfileCardBadge> : null}
      {isLeader && !isWinner ? <ProfileCardBadge tone="leading">Leading</ProfileCardBadge> : null}
      {isWinner ? <ProfileCardBadge tone="winner">Winner</ProfileCardBadge> : null}
    </>
  );

  const footer = (
    <div className="space-y-2">
      {share !== null ? (
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-2xl font-semibold text-[var(--psc-ink)]">
            {(share * 100).toFixed(1)}%
          </span>
          {shareLabel ? (
            <span className="text-[11px] uppercase tracking-wide text-[var(--psc-muted)]">
              {shareLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      {mode !== "none" ? (
        <form action={mode === "primary" ? castPrimaryVote : castGeneralVote}>
          <input type="hidden" name="election_id" value={electionId} />
          <input type="hidden" name="candidate_id" value={cand.id} />
          <SubmitButton
            disabled={disabled}
            variant={selected ? "selected" : "ghost"}
            pendingLabel={selected ? "Unvoting…" : "Voting…"}
          >
            {selected ? "Unvote" : "Vote"}
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );

  return (
    <ProfileCard
      profile={{
        id: cand.user_id,
        character_name: name,
        face_claim_url: card?.face_claim_url ?? null,
        party: cand.party,
        bio: card?.bio ?? null,
        residence_state: card?.residence_state ?? null,
        home_district_code: card?.home_district_code ?? null,
      }}
      emphasizeParty={emphasizeParty}
      selected={selected}
      winner={isWinner}
      badges={badges}
      footer={footer}
      href={profilePath(cand.user_id) ?? undefined}
    />
  );
}

type CandidateScore = {
  id: string;
  user_id: string;
  party: string;
  campaign_points_with_lean: number;
  votes: number;
  share: number;
};

function computeScores(
  cands: CandRow[],
  partisanLean: number,
  generalTally: Record<string, number>,
): CandidateScore[] {
  const inputs = cands.map((c) => {
    const lean =
      c.party === "democrat"
        ? districtLeanBonus(partisanLean, "democrat")
        : c.party === "republican"
          ? districtLeanBonus(partisanLean, "republican")
          : 0;
    const pts = Math.max(0, Number(c.campaign_points_total ?? 0) + lean);
    const votes = generalTally[c.id] ?? 0;
    return { cand: c, pts, votes };
  });

  const campTotal = inputs.reduce((s, i) => s + i.pts, 0);
  const voteTotal = inputs.reduce((s, i) => s + i.votes, 0);
  const n = Math.max(1, inputs.length);

  const scored = inputs.map(({ cand, pts, votes }) => {
    const campShare = campTotal > 0 ? pts / campTotal : 1 / n;
    const voteShare = voteTotal > 0 ? votes / voteTotal : 1 / n;
    const share = 0.6 * campShare + 0.4 * voteShare;
    return {
      id: cand.id,
      user_id: cand.user_id,
      party: cand.party,
      campaign_points_with_lean: pts,
      votes,
      share,
    };
  });

  const sum = scored.reduce((s, i) => s + i.share, 0) || 1;
  return scored.map((s) => ({ ...s, share: s.share / sum }));
}

/**
 * Leadership races are decided by plain plurality of general votes — no PVI lean, no
 * campaign points. We still return a CandidateScore so SpreadBar and the per-card
 * percentage share the same shape as seat races.
 */
function computeLeadershipScores(
  cands: CandRow[],
  generalTally: Record<string, number>,
): CandidateScore[] {
  const n = Math.max(1, cands.length);
  const voteTotal = cands.reduce((s, c) => s + (generalTally[c.id] ?? 0), 0);
  return cands.map((c) => {
    const votes = generalTally[c.id] ?? 0;
    const share = voteTotal > 0 ? votes / voteTotal : 1 / n;
    return {
      id: c.id,
      user_id: c.user_id,
      party: c.party,
      campaign_points_with_lean: 0,
      votes,
      share,
    };
  });
}

function SpreadBar({
  scores,
  nameBy,
  candidateCardByUserId,
}: {
  scores: CandidateScore[];
  nameBy: Record<string, string>;
  candidateCardByUserId: Record<string, CandidateCardFields>;
}) {
  if (scores.length < 2) return null;

  const sorted = [...scores].sort((a, b) => b.share - a.share);

  const segments = sorted.map((s) => {
    const meta = partyMeta(s.party);
    const name =
      candidateCardByUserId[s.user_id]?.character_name?.trim() ||
      nameBy[s.user_id]?.trim() ||
      s.user_id.slice(0, 8);
    let color = "bg-slate-400";
    if (s.party === "democrat") color = "bg-blue-600";
    else if (s.party === "republican") color = "bg-red-600";
    else if (s.party === "independent") color = "bg-slate-600";
    return { ...s, meta, name, color };
  });

  return (
    <section className="space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
          Projected vote
        </h3>
        <span className="text-[10px] text-[var(--psc-muted)]">
          60% campaign points + 40% community votes
        </span>
      </div>
      <div className="flex h-7 w-full overflow-hidden rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)]">
        {segments.map((s) => (
          <div
            key={s.id}
            className={`${s.color} flex items-center justify-center text-[10px] font-semibold text-white transition-[width]`}
            style={{ width: `${Math.max(0, s.share * 100)}%` }}
            title={`${s.name}: ${(s.share * 100).toFixed(1)}%`}
          >
            {s.share > 0.12 ? `${Math.round(s.share * 100)}%` : ""}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {segments.map((s) => (
          <div key={s.id} className="flex min-w-0 items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.color}`} />
            <span className="truncate">
              <span className="font-semibold text-[var(--psc-ink)]">{s.name}</span>
              <span className="ml-1 text-[var(--psc-muted)]">
                · {(s.share * 100).toFixed(1)}% · {s.votes} votes · {s.campaign_points_with_lean.toFixed(1)} pts
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CampaignPanel({
  election,
  myCandidate,
  myRalliesInWindow,
  myRallyLimit,
  myRallyWindowHours,
  myNextRallyAt,
  speechCount,
  rallyCount,
  states,
  partisanLean,
}: {
  election: ElectionRow;
  myCandidate: CandRow;
  myRalliesInWindow: number;
  myRallyLimit: number;
  myRallyWindowHours: number;
  myNextRallyAt: string | null;
  speechCount: number;
  rallyCount: number;
  states: Array<{ code: string; name: string }>;
  partisanLean: number;
}) {
  const meta = partyMeta(myCandidate.party);
  const leanForMe =
    myCandidate.party === "democrat"
      ? districtLeanBonus(partisanLean, "democrat")
      : myCandidate.party === "republican"
        ? districtLeanBonus(partisanLean, "republican")
        : 0;

  return (
    <section className="space-y-4 border-2 border-[var(--psc-accent)]/40 bg-[var(--psc-panel)] p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--psc-ink)]">
            Your campaign
          </h2>
          <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
            Running as{" "}
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${meta.pill}`}
            >
              {meta.label}
            </span>
            {leanForMe ? (
              <>
                {" "}
                · Starting lean {leanForMe > 0 ? "+" : ""}
                {leanForMe.toFixed(1)} pts
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-[var(--psc-muted)]">
          <span>
            Speeches: <strong className="text-[var(--psc-ink)]">{speechCount}</strong>
          </span>
          <span>
            Rallies: <strong className="text-[var(--psc-ink)]">{rallyCount}</strong>
          </span>
          <span>
            Total points:{" "}
            <strong className="text-[var(--psc-ink)]">
              {Number(myCandidate.campaign_points_total ?? 0).toFixed(1)}
            </strong>
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SpeechForm
          electionId={election.id}
          office={election.office}
          state={election.state}
          districtCode={election.district_code}
          states={states}
        />
        <RallyForm
          electionId={election.id}
          office={election.office}
          state={election.state}
          districtCode={election.district_code}
          used={myRalliesInWindow}
          limit={myRallyLimit}
          windowHours={myRallyWindowHours}
          nextUnlockAt={myNextRallyAt}
          states={states}
        />
      </div>
    </section>
  );
}

/**
 * How to display a candidate's "score" on their card:
 * - "primary": percentage of primary votes cast so far (denominator = all primary votes)
 * - "general": blended 60/40 campaign-points + community-votes share (same math as SpreadBar)
 * - "none":    no percentage shown (filing phase)
 */
type ShareMode = "none" | "primary" | "general";

function PartyGroupedCandidates({
  candidates,
  card,
  nameBy,
  winnerUserId,
  userId,
  primaryTally,
  generalShareById,
  shareMode,
  leaderCandidateId,
  primaryOpenForPartyOnly,
  primaryPartyRestriction,
  myPrimaryCandidateId,
  myGeneralCandidateId,
  electionId,
  mode,
  voteDisabled,
  emptyMessage,
  emphasizeParty,
}: {
  candidates: CandRow[];
  card: Record<string, CandidateCardFields>;
  nameBy: Record<string, string>;
  winnerUserId: string | null;
  userId: string;
  primaryTally: Record<string, number>;
  generalShareById: Record<string, number>;
  shareMode: ShareMode;
  leaderCandidateId: string | null;
  primaryOpenForPartyOnly: string | null;
  primaryPartyRestriction: boolean;
  myPrimaryCandidateId: string | null;
  myGeneralCandidateId: string | null;
  electionId: string;
  mode: VoteMode;
  voteDisabled: boolean;
  emptyMessage: string;
  emphasizeParty: boolean;
}) {
  if (!candidates.length) {
    return (
      <p className="rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-4 text-sm text-[var(--psc-muted)]">
        {emptyMessage}
      </p>
    );
  }

  const groups = new Map<string, CandRow[]>();
  for (const c of candidates) {
    const key = PARTY_ORDER.includes(c.party as PartyKey) ? c.party : "independent";
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const orderedKeys = PARTY_ORDER.filter((k) => groups.has(k));
  for (const k of groups.keys()) {
    if (!orderedKeys.includes(k as PartyKey)) orderedKeys.push(k as PartyKey);
  }

  return (
    <div className="space-y-6">
      {orderedKeys.map((party) => {
        const meta = partyMeta(party);
        const list = groups.get(party) ?? [];
        const canVoteInThisParty =
          mode === "primary" &&
          !voteDisabled &&
          (primaryOpenForPartyOnly === null || primaryOpenForPartyOnly === party);
        const mayVoteHere =
          mode === "general" ? !voteDisabled : canVoteInThisParty;

        // Each party runs its own primary. The percentage denominator is the sum of votes cast
        // within this party only — the Dem and Rep primaries are separate races, so a Dem with
        // 1 vote in a one-candidate field should show 100%, not 50%.
        const partyPrimaryTotal = list.reduce(
          (s, c) => s + (primaryTally[c.id] ?? 0),
          0,
        );

        // "Leading" inside the primary means plurality within this party.
        let primaryLeaderId: string | null = null;
        if (shareMode === "primary") {
          let bestCount = 0;
          for (const c of list) {
            const n = primaryTally[c.id] ?? 0;
            if (n > bestCount) {
              bestCount = n;
              primaryLeaderId = c.id;
            } else if (n === bestCount && bestCount > 0) {
              primaryLeaderId = null;
            }
          }
        }

        return (
          <div key={party} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${meta.pill}`}
                >
                  {meta.label}
                </span>
                <span className="text-xs text-[var(--psc-muted)]">
                  {list.length} candidate{list.length === 1 ? "" : "s"}
                </span>
                {shareMode === "primary" ? (
                  <span className="text-xs text-[var(--psc-muted)]">
                    · {partyPrimaryTotal} vote{partyPrimaryTotal === 1 ? "" : "s"} cast
                  </span>
                ) : null}
              </h3>
              {mode === "primary" &&
              primaryPartyRestriction &&
              primaryOpenForPartyOnly !== null &&
              primaryOpenForPartyOnly !== party ? (
                <span className="text-xs text-[var(--psc-muted)]">
                  Voting locked — not your party
                </span>
              ) : null}
            </div>
            <ul className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
              {list.map((c) => {
                const selected =
                  mode === "primary"
                    ? myPrimaryCandidateId === c.id
                    : mode === "general"
                      ? myGeneralCandidateId === c.id
                      : false;

                let share: number | null = null;
                let shareLabel: string | null = null;
                if (shareMode === "primary") {
                  const n = primaryTally[c.id] ?? 0;
                  share = partyPrimaryTotal > 0 ? n / partyPrimaryTotal : 0;
                  shareLabel = `${n} vote${n === 1 ? "" : "s"}`;
                } else if (shareMode === "general") {
                  share = generalShareById[c.id] ?? 0;
                  shareLabel = "projected";
                }

                // Use the primary leader for this specific party, not the parent's leader
                // (which is only meaningful for the general).
                const effectiveLeaderId =
                  shareMode === "primary" ? primaryLeaderId : leaderCandidateId;

                return (
                  <li key={c.id}>
                    <CandidateCard
                      cand={c}
                      card={card[c.user_id]}
                      name={displayName(card[c.user_id], c.user_id, nameBy)}
                      isYou={c.user_id === userId}
                      isWinner={winnerUserId === c.user_id}
                      isLeader={effectiveLeaderId === c.id}
                      share={share}
                      shareLabel={shareLabel}
                      selected={selected}
                      mode={mayVoteHere ? mode : "none"}
                      electionId={electionId}
                      disabled={!mayVoteHere}
                      emphasizeParty={emphasizeParty}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function ElectionDetail({
  election,
  candidates,
  nameBy,
  candidateCardByUserId,
  primaryTally,
  generalTally,
  myPrimaryCandidateId,
  myGeneralCandidateId,
  profileParty,
  userId,
  isAdmin,
  winnerName,
  partisanLean,
  speechCountBy,
  rallyCountBy,
  myRalliesInWindow,
  myNextRallyAt,
  states,
  filingBlockReason,
  leadershipMeta,
}: {
  election: ElectionRow;
  candidates: CandRow[];
  nameBy: Record<string, string>;
  candidateCardByUserId: Record<string, CandidateCardFields>;
  primaryTally: Record<string, number>;
  generalTally: Record<string, number>;
  myPrimaryCandidateId: string | null;
  myGeneralCandidateId: string | null;
  profileParty: string | null;
  filingBlockReason: string | null;
  userId: string;
  isAdmin: boolean;
  winnerName: string | null;
  partisanLean: number;
  speechCountBy: Record<string, number>;
  rallyCountBy: Record<string, number>;
  myRalliesInWindow: number;
  myNextRallyAt: string | null;
  states: Array<{ code: string; name: string }>;
  leadershipMeta: LeadershipMeta | null;
}) {
  const now = new Date();
  const filingOpen =
    election.phase === "filing" &&
    now >= new Date(election.filing_opens_at) &&
    now <= new Date(election.filing_closes_at);
  const primaryOpen =
    election.phase === "primary" &&
    !!election.primary_closes_at &&
    now <= new Date(election.primary_closes_at);
  const generalOpen =
    election.phase === "general" && now <= new Date(election.general_closes_at);

  const myRow = candidates.find((c) => c.user_id === userId);
  const isLeadership = !!leadershipMeta;
  const canFileCandidacy = filingBlockReason === null;
  const hasPrimaryWinners = candidates.some((c) => c.primary_winner);
  const generalCandidates = hasPrimaryWinners
    ? candidates.filter((c) => c.primary_winner)
    : candidates;

  const primaryPartyRestricted =
    election.primary_party_wide === false && election.office !== "president";
  const primaryOpenForPartyOnly = profileParty ?? null;

  // Live leader of the general: plurality of general votes among nominees, undefined if no votes cast.
  let generalLeaderId: string | null = null;
  if (election.phase === "general" || election.phase === "closed") {
    let bestCount = 0;
    for (const c of generalCandidates) {
      const n = generalTally[c.id] ?? 0;
      if (n > bestCount) {
        bestCount = n;
        generalLeaderId = c.id;
      } else if (n === bestCount && bestCount > 0) {
        generalLeaderId = null;
      }
    }
  }

  // Leadership races: plain plurality share (no PVI, no campaign points). Seat races: 60/40
  // blended FEC score. Both paths populate generalShareById so the SpreadBar + each card show
  // the same projected percentage.
  const generalScores = isLeadership
    ? computeLeadershipScores(generalCandidates, generalTally)
    : computeScores(generalCandidates, partisanLean, generalTally);
  const generalShareById: Record<string, number> = {};
  for (const s of generalScores) generalShareById[s.id] = s.share;

  const seatLabel = isLeadership
    ? leadershipMeta!.label
    : (election.district_code ?? election.state ?? "United States");

  const meta = partyMeta(profileParty ?? "");

  return (
    <div className="space-y-8">
      {isAdmin ? (
        <Link
          href={`/admin/elections/${election.id}`}
          className="inline-block text-sm font-semibold text-[var(--psc-accent)] underline"
        >
          Admin console for this race →
        </Link>
      ) : null}

      <header className="space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)]">
            {election.phase}
          </span>
          <span className="text-xs text-[var(--psc-muted)]">
            {isLeadership
              ? `${election.office.toUpperCase()} · LEADERSHIP`
              : election.office.toUpperCase()}
          </span>
          {isLeadership && leadershipMeta?.restricted_party ? (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${partyMeta(leadershipMeta.restricted_party).pill}`}>
              {partyMeta(leadershipMeta.restricted_party).label} caucus
            </span>
          ) : null}
        </div>
        <h1 className="text-2xl font-semibold">{seatLabel}</h1>
        {isLeadership ? (
          <p className="text-sm text-[var(--psc-muted)]">
            Leadership race — decided by a plain plurality of chamber votes. Winners gain the
            leadership role alongside their existing{" "}
            {election.office === "house" ? "representative" : "senator"} role.
          </p>
        ) : null}
        <dl className="grid gap-2 text-xs text-[var(--psc-muted)] sm:grid-cols-2">
          <div>
            Filing: {new Date(election.filing_opens_at).toLocaleString()} —{" "}
            {new Date(election.filing_closes_at).toLocaleString()}
          </div>
          {!isLeadership && election.primary_closes_at ? (
            <div>Primary closes: {new Date(election.primary_closes_at).toLocaleString()}</div>
          ) : null}
          <div>General closes: {new Date(election.general_closes_at).toLocaleString()}</div>
        </dl>
      </header>

      {election.phase === "closed" && election.winner_user_id ? (
        <section className="border-2 border-emerald-700 bg-emerald-50 p-6 text-emerald-950">
          <h2 className="text-sm font-semibold uppercase tracking-wide">
            Certified winner
          </h2>
          <p className="mt-1 text-2xl font-semibold">
            {winnerName ?? election.winner_user_id}
          </p>
        </section>
      ) : null}

      {/* FILING PHASE */}
      {election.phase === "filing" ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
            <div className="min-w-0 max-w-2xl">
              <h2 className="text-lg font-semibold">Filing window</h2>
              <p className="mt-1 text-sm text-[var(--psc-muted)]">
                Candidates file as their current party automatically.{" "}
                {isLeadership
                  ? `Only sitting ${election.office === "house" ? "representatives" : "senators"}${
                      leadershipMeta?.restricted_party
                        ? ` in the ${leadershipMeta.restricted_party} caucus`
                        : ""
                    } can file.`
                  : election.office === "house"
                    ? "Only players whose home district matches this seat can file."
                    : election.office === "senate"
                      ? "Only players whose residence state matches this seat can file."
                      : "Any eligible player can file for president."}
              </p>
            </div>
            <div className="flex flex-col items-stretch gap-2">
              {myRow ? (
                <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  You&apos;re filed as{" "}
                  <strong>{partyMeta(myRow.party).label}</strong>.
                </p>
              ) : !filingOpen ? (
                <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Filing is not open right now.
                </p>
              ) : canFileCandidacy ? (
                <form action={fileCandidacy}>
                  <input type="hidden" name="election_id" value={election.id} />
                  <SubmitButton pendingLabel="Filing…">
                    File as{" "}
                    <span className={`ml-1 rounded-sm px-1 ${meta.pill}`}>
                      {meta.label}
                    </span>
                  </SubmitButton>
                  <p className="mt-2 text-center text-[10px] text-[var(--psc-muted)]">
                    Party auto-pulled from your Character page.
                  </p>
                </form>
              ) : (
                <p className="max-w-xs rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {filingBlockReason}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                Filed candidates
              </h3>
              <span className="text-xs text-[var(--psc-muted)]">
                {candidates.length} total
              </span>
            </div>
            <PartyGroupedCandidates
              candidates={candidates}
              card={candidateCardByUserId}
              nameBy={nameBy}
              winnerUserId={election.winner_user_id}
              userId={userId}
              primaryTally={primaryTally}
              generalShareById={generalShareById}
              shareMode="none"
              leaderCandidateId={null}
              primaryOpenForPartyOnly={null}
              primaryPartyRestriction={false}
              myPrimaryCandidateId={null}
              myGeneralCandidateId={null}
              electionId={election.id}
              mode="none"
              voteDisabled
              emptyMessage="No one has filed yet. Be the first — if you're eligible."
              emphasizeParty={false}
            />
          </div>
        </section>
      ) : null}

      {/* PRIMARY PHASE */}
      {election.phase === "primary" ? (
        <section className="space-y-4">
          <div className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
            <h2 className="text-lg font-semibold">Primary ballot</h2>
            <p className="mt-1 text-sm text-[var(--psc-muted)]">
              Your party is{" "}
              <strong>{partyMeta(profileParty ?? "").label}</strong>. You can only
              vote on candidates in your party.
              {primaryPartyRestricted ? (
                <> This primary is limited to players whose Character record matches this seat.</>
              ) : (
                <> This primary is open party-wide.</>
              )}
            </p>
          </div>
          <PartyGroupedCandidates
            candidates={candidates}
            card={candidateCardByUserId}
            nameBy={nameBy}
            winnerUserId={election.winner_user_id}
            userId={userId}
            primaryTally={primaryTally}
            generalShareById={generalShareById}
            shareMode="primary"
            leaderCandidateId={null}
            primaryOpenForPartyOnly={primaryOpenForPartyOnly}
            primaryPartyRestriction={primaryPartyRestricted}
            myPrimaryCandidateId={myPrimaryCandidateId}
            myGeneralCandidateId={null}
            electionId={election.id}
            mode="primary"
            voteDisabled={!primaryOpen || !profileParty}
            emptyMessage="No one filed for this race."
            emphasizeParty
          />
        </section>
      ) : null}

      {/* GENERAL PHASE */}
      {election.phase === "general" ? (
        <section className="space-y-4">
          <SpreadBar
            scores={generalScores}
            nameBy={nameBy}
            candidateCardByUserId={candidateCardByUserId}
          />
          {!isLeadership && myRow && myRow.primary_winner ? (
            <CampaignPanel
              election={election}
              myCandidate={myRow}
              myRalliesInWindow={myRalliesInWindow}
              myRallyLimit={10}
              myRallyWindowHours={3}
              myNextRallyAt={myNextRallyAt}
              speechCount={speechCountBy[myRow.id] ?? 0}
              rallyCount={rallyCountBy[myRow.id] ?? 0}
              states={states}
              partisanLean={partisanLean}
            />
          ) : null}
          <div className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
            <h2 className="text-lg font-semibold">
              {isLeadership ? "Chamber vote" : "General election"}
            </h2>
            <p className="mt-1 text-sm text-[var(--psc-muted)]">
              {isLeadership
                ? `Vote once per race — you can vote for yourself. Only ${
                    election.office === "house" ? "representatives" : "senators"
                  }${
                    leadershipMeta?.restricted_party
                      ? ` in the ${leadershipMeta.restricted_party} caucus`
                      : ""
                  } can cast a ballot. The winner is the candidate with the most votes; ties go to the earliest filer.`
                : "Vote once per race — you can vote for yourself. The live vote leader is visible to everyone, but individual ballots stay private. For House and Senate, the final score blends community votes with campaign points (60/40), starting from the partisan lean shown above."}
            </p>
          </div>
          <PartyGroupedCandidates
            candidates={generalCandidates}
            card={candidateCardByUserId}
            nameBy={nameBy}
            winnerUserId={election.winner_user_id}
            userId={userId}
            primaryTally={primaryTally}
            generalShareById={generalShareById}
            shareMode="general"
            leaderCandidateId={generalLeaderId}
            primaryOpenForPartyOnly={null}
            primaryPartyRestriction={false}
            myPrimaryCandidateId={null}
            myGeneralCandidateId={myGeneralCandidateId}
            electionId={election.id}
            mode="general"
            voteDisabled={!generalOpen}
            emptyMessage="No candidates on the general ballot."
            emphasizeParty
          />
        </section>
      ) : null}

      {/* CLOSED PHASE (final roster) */}
      {election.phase === "closed" ? (
        <section className="space-y-3">
          <SpreadBar
            scores={generalScores}
            nameBy={nameBy}
            candidateCardByUserId={candidateCardByUserId}
          />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Final roster
          </h3>
          <PartyGroupedCandidates
            candidates={candidates}
            card={candidateCardByUserId}
            nameBy={nameBy}
            winnerUserId={election.winner_user_id}
            userId={userId}
            primaryTally={primaryTally}
            generalShareById={generalShareById}
            shareMode="general"
            leaderCandidateId={null}
            primaryOpenForPartyOnly={null}
            primaryPartyRestriction={false}
            myPrimaryCandidateId={null}
            myGeneralCandidateId={null}
            electionId={election.id}
            mode="none"
            voteDisabled
            emptyMessage="No candidates for this race."
            emphasizeParty
          />
        </section>
      ) : null}
    </div>
  );
}
