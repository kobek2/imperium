import { ProfileCard, ProfileCardBadge, profilePath } from "@/components/profile-card";
import { SubmitButton } from "@/components/submit-button";
import {
  castGeneralVote,
  castPrimaryVote,
  fileCandidacy,
  submitCampaignEndorsement,
  withdrawCampaignEndorsement,
} from "@/app/actions/elections";
import { OpenSeatFilingForm } from "@/components/open-seat-filing-form";
import { districtLeanBonus } from "@/lib/fec";
import type { LeadershipRole } from "@/lib/leadership";
import { RallyForm } from "./rally-form";
import { SpeechForm } from "./speech-form";
import {
  CampaignSpeechArchive,
  type CampaignSpeechArchiveItem,
} from "@/components/campaign-speech-archive";
import {
  CAMPAIGN_AD_UNIT_PRICE,
  campaignAdCountFromPoints,
  campaignAdSpendUsd,
  formatCampaignAdSpendUsd,
} from "@/lib/campaign-ad-stats";
import type { CampaignAdInventory } from "@/lib/campaign-ad-inventory";
import { CampaignAdForm } from "./campaign-ad-form";
import { WithdrawFilingForm } from "./withdraw-filing-form";
import { ElectionPacFilings } from "@/components/election-pac-filings";
import type { ElectionPacFilingsBundle } from "@/lib/pac-filings";

type ElectionRow = {
  id: string;
  office: string;
  state: string | null;
  district_code: string | null;
  senate_class?: number | null;
  phase: string;
  filing_opens_at: string;
  filing_closes_at: string;
  primary_closes_at: string | null;
  general_closes_at: string;
  winner_user_id: string | null;
  winner_candidate_id?: string | null;
  primary_party_wide?: boolean | null;
  leadership_role?: string | null;
  restricted_party?: string | null;
  filing_window_started_at?: string | null;
};

type LeadershipMeta = {
  role: LeadershipRole;
  label: string;
  restricted_party: "democrat" | "republican" | "independent" | null;
};

type CandRow = {
  id: string;
  user_id: string | null;
  party: string;
  campaign_points_total: number | null;
  primary_winner: boolean | null;
  created_at?: string | null;
  running_mate_user_id?: string | null;
  running_mate_name?: string | null;
  is_npc?: boolean | null;
  npc_name?: string | null;
  npc_synthetic_votes?: number | null;
};

type CandidateCardFields = {
  character_name: string | null;
  face_claim_url: string | null;
  residence_state: string | null;
  home_district_code: string | null;
  bio: string | null;
};

type SpeechFeedItem = {
  candidateId: string;
  authorId: string;
  content: string;
  targetState: string | null;
  createdAt: string;
};

type AdSpendFeedItem = {
  actorId: string;
  candidateId: string;
  targetState: string | null;
  points: number;
  costUsd: number | null;
  createdAt: string;
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

function displayName(
  cand: Pick<CandRow, "is_npc" | "npc_name" | "user_id">,
  card: CandidateCardFields | undefined,
  nameBy: Record<string, string>,
) {
  if (cand.is_npc && cand.npc_name?.trim()) {
    return `${cand.npc_name.trim()} (NPC)`;
  }
  const userId = cand.user_id;
  if (!userId) return "NPC";
  const n = card?.character_name?.trim() || nameBy[userId]?.trim();
  return n || userId.slice(0, 8);
}

function AdSpendFeedSection({
  adSpendFeed,
  candidateById,
  candidateCardByUserId,
  nameBy,
  listKeyPrefix,
}: {
  adSpendFeed: AdSpendFeedItem[];
  candidateById: Map<string, CandRow>;
  candidateCardByUserId: Record<string, CandidateCardFields>;
  nameBy: Record<string, string>;
  listKeyPrefix: string;
}) {
  if (!adSpendFeed.length) return null;
  return (
    <section className="space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          Campaign ads spent
        </h3>
        <span className="text-xs text-[var(--psc-muted)]">
          Latest {adSpendFeed.length} spend{adSpendFeed.length === 1 ? "" : "s"} (bulk combined)
        </span>
      </div>
      <ul className="max-h-[20rem] space-y-2 overflow-y-auto pr-1 text-sm">
        {adSpendFeed.map((ad, idx) => {
          const cand = candidateById.get(ad.candidateId);
          const candName = cand
            ? displayName(cand, candidateCardByUserId[cand.user_id ?? ""], nameBy)
            : ad.candidateId.slice(0, 8);
          const actorName =
            candidateCardByUserId[ad.actorId]?.character_name?.trim() ||
            nameBy[ad.actorId]?.trim() ||
            ad.actorId.slice(0, 8);
          const loc = ad.targetState ? ` · ${ad.targetState}` : "";
          const ads = campaignAdCountFromPoints(ad.points);
          const spendUsd = ad.costUsd != null && ad.costUsd > 0 ? ad.costUsd : campaignAdSpendUsd(ad.points);
          const adLabel = ads === 1 ? "1 ad" : `${ads} ads`;
          return (
            <li
              key={`${listKeyPrefix}-${ad.createdAt}:${ad.actorId}:${ad.candidateId}:${idx}`}
              className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/40 px-3 py-2 text-[var(--psc-ink)]"
            >
              <p className="text-[11px] leading-relaxed text-[var(--psc-muted)]">
                <span className="font-semibold text-[var(--psc-ink)]">{actorName}</span>
                {" · "}
                <span className="font-mono text-[var(--psc-ink)]">
                  {adLabel} ({formatCampaignAdSpendUsd(spendUsd)})
                </span>
                {" for "}
                <span className="font-semibold text-[var(--psc-ink)]">{candName}</span>
                {loc}
                {" · "}
                {new Date(ad.createdAt).toLocaleString()}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type VoteMode = "none" | "primary" | "general";

/**
 * A single candidate tile. We show a single percentage — either their primary vote share or
 * their blended general score — instead of the old "Primary: 8 · General: 10 · Speeches: 3…"
 * list. Campaign-activity rollups (general only for president) live in <CampaignPanel/>.
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
  endorsementPoints,
  endorsedByMe,
  electionOffice,
  allowGeneralBallot,
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
  endorsementPoints: number;
  endorsedByMe: boolean;
  electionOffice: string;
  allowGeneralBallot: boolean;
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
        <div className="space-y-2">
          {mode === "primary" || (mode === "general" && allowGeneralBallot) ? (
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
          {mode === "general" ? (
            endorsementPoints > 0 || electionOffice === "president" ? (
              endorsedByMe ? (
                <form action={withdrawCampaignEndorsement}>
                  <input type="hidden" name="election_id" value={electionId} />
                  <SubmitButton variant="ghost" pendingLabel="Withdrawing…">
                    Withdraw endorsement
                  </SubmitButton>
                </form>
              ) : (
                <form action={submitCampaignEndorsement}>
                  <input type="hidden" name="election_id" value={electionId} />
                  <input type="hidden" name="candidate_id" value={cand.id} />
                  <SubmitButton variant="ghost" pendingLabel="Endorsing…">
                    {electionOffice === "president"
                      ? `Endorse${endorsementPoints > 0 ? ` (${endorsementPoints} pts)` : ""}`
                      : `Endorse (${endorsementPoints} pts)`}
                  </SubmitButton>
                </form>
              )
            ) : (
              <p className="text-[10px] text-[var(--psc-muted)]">
                Endorsements require an eligible office role.
              </p>
            )
          ) : null}
        </div>
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
  user_id: string | null;
  party: string;
  campaign_points_with_lean: number;
  share: number;
};

function computeScores(
  cands: CandRow[],
  partisanLean: number,
  _generalTally: Record<string, number>,
): CandidateScore[] {
  void _generalTally;
  const inputs = cands.map((c) => {
    const lean =
      c.party === "democrat"
        ? districtLeanBonus(partisanLean, "democrat")
        : c.party === "republican"
          ? districtLeanBonus(partisanLean, "republican")
          : 0;
    const pts = Math.max(0, Number(c.campaign_points_total ?? 0) + lean);
    return { cand: c, pts };
  });

  const campTotal = inputs.reduce((s, i) => s + i.pts, 0);
  const n = Math.max(1, inputs.length);

  const scored = inputs.map(({ cand, pts }) => {
    const campShare = campTotal > 0 ? pts / campTotal : 1 / n;
    const share = campShare;
    return {
      id: cand.id,
      user_id: cand.user_id,
      party: cand.party,
      campaign_points_with_lean: pts,
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
  if (!scores.length) return null;

  const sorted = [...scores].sort((a, b) => b.share - a.share);

  const segments = sorted.map((s) => {
    const meta = partyMeta(s.party);
    const name = s.user_id
      ? candidateCardByUserId[s.user_id]?.character_name?.trim() ||
        nameBy[s.user_id]?.trim() ||
        s.user_id.slice(0, 8)
      : `Candidate ${s.id.slice(0, 8)}`;
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
          Point share from campaign totals
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
                · {(s.share * 100).toFixed(1)}% · {s.campaign_points_with_lean.toFixed(1)} pts
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
  isVolunteer,
  userId,
  myRalliesInWindow,
  myRallyLimit,
  myRallyWindowHours,
  myNextRallyAt,
  speechCount,
  rallyCount,
  states,
  partisanLean,
  opponentCandidates,
  adsInventory,
}: {
  election: ElectionRow;
  myCandidate: CandRow;
  isVolunteer: boolean;
  userId: string;
  myRalliesInWindow: number;
  myRallyLimit: number;
  myRallyWindowHours: number;
  myNextRallyAt: string | null;
  speechCount: number;
  rallyCount: number;
  states: Array<{ code: string; name: string }>;
  partisanLean: number;
  opponentCandidates: Array<{ id: string; label: string }>;
  adsInventory: CampaignAdInventory;
}) {
  const isRunningMate = false;
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
            {isVolunteer
              ? "Campaign with your endorsed candidate"
              : isRunningMate
                ? "Your campaign (running mate)"
                : "Your campaign"}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
            {isVolunteer
              ? "Volunteer campaigning on your endorsed ticket · "
              : isRunningMate
                ? "Co-campaigning on this ticket · "
                : null}
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
      <CampaignAdForm
        electionId={election.id}
        inventory={adsInventory}
        opponentCandidates={opponentCandidates}
      />
    </section>
  );
}

/**
 * How to display a candidate's "score" on their card:
 * - "primary": percentage of primary votes cast so far (denominator = all primary votes)
 * - "general": campaign-point share (same math as SpreadBar for seat/pres races)
 * - "none":    no percentage shown (filing phase)
 */
type ShareMode = "none" | "primary" | "general";

function PartyGroupedCandidates({
  candidates,
  electionOffice,
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
  myEndorsedCandidateId,
  myEndorsementPoints,
  allowGeneralBallot,
}: {
  candidates: CandRow[];
  electionOffice: string;
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
  myEndorsedCandidateId: string | null;
  myEndorsementPoints: number;
  allowGeneralBallot: boolean;
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
                      card={c.user_id ? card[c.user_id] : undefined}
                      name={displayName(c, c.user_id ? card[c.user_id] : undefined, nameBy)}
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
                      endorsementPoints={myEndorsementPoints}
                      endorsedByMe={myEndorsedCandidateId === c.id}
                      electionOffice={electionOffice}
                      allowGeneralBallot={allowGeneralBallot}
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
  myEndorsedCandidateId,
  myEndorsementPoints,
  profileParty,
  userId,
  isAdmin,
  winnerName,
  winnerNpcName = null,
  partisanLean,
  speechCountBy,
  rallyCountBy,
  myRalliesInWindow,
  myNextRallyAt,
  states,
  filingBlockReason,
  leadershipMeta,
  canCastLeadershipGeneralVote,
  adsInventory,
  speechFeed,
  speechArchive = null,
  adSpendFeed,
  totalCampaignAdSpendUsd,
  totalCampaignAdsPlaced = 0,
  viewerIsIncumbentForThisSenateSeat = false,
  npcActivity = [],
  pacFilings = null,
}: {
  election: ElectionRow;
  candidates: CandRow[];
  nameBy: Record<string, string>;
  candidateCardByUserId: Record<string, CandidateCardFields>;
  primaryTally: Record<string, number>;
  generalTally: Record<string, number>;
  myPrimaryCandidateId: string | null;
  myGeneralCandidateId: string | null;
  myEndorsedCandidateId: string | null;
  myEndorsementPoints: number;
  profileParty: string | null;
  filingBlockReason: string | null;
  userId: string;
  isAdmin: boolean;
  winnerName: string | null;
  winnerNpcName?: string | null;
  partisanLean: number;
  speechCountBy: Record<string, number>;
  rallyCountBy: Record<string, number>;
  myRalliesInWindow: number;
  myNextRallyAt: string | null;
  states: Array<{ code: string; name: string }>;
  leadershipMeta: LeadershipMeta | null;
  canCastLeadershipGeneralVote: boolean;
  adsInventory: CampaignAdInventory;
  speechFeed: SpeechFeedItem[];
  speechArchive?: CampaignSpeechArchiveItem[] | null;
  adSpendFeed: AdSpendFeedItem[];
  /** Sum of list-price spend for ads placed in this race (0 for leadership). */
  totalCampaignAdSpendUsd: number;
  /** Inventory ads consumed in this race (equals summed campaign_ads.points). */
  totalCampaignAdsPlaced?: number;
  /** True when this race is the viewer's current Senate class seat in their home state. */
  viewerIsIncumbentForThisSenateSeat?: boolean;
  npcActivity?: Array<{
    id: string;
    action_type: string;
    succeeded: boolean;
    points_delta: number;
    message: string;
    created_at: string;
  }>;
  pacFilings?: ElectionPacFilingsBundle | null;
}) {
  const now = new Date();
  const isLeadership = !!leadershipMeta;
  const filingWindowLive =
    isLeadership ||
    election.phase !== "filing" ||
    (election.filing_window_started_at != null && election.filing_window_started_at !== "");
  // Seat races can be dormant templates until admins set filing_window_started_at.
  const filingOpen =
    filingWindowLive &&
    election.phase === "filing" &&
    now <= new Date(election.filing_closes_at);
  const primaryOpen =
    election.phase === "primary" &&
    !!election.primary_closes_at &&
    now <= new Date(election.primary_closes_at);
  const generalOpen =
    election.phase === "general" && now <= new Date(election.general_closes_at);

  const myRow = candidates.find((c) => c.user_id === userId);
  const myTicketRow = candidates.find(
    (c) => c.user_id === userId,
  );
  const myEndorsedRow =
    election.office === "president" && myEndorsedCandidateId
      ? candidates.find((c) => c.id === myEndorsedCandidateId) ?? null
      : null;
  const campaignRow = election.office === "president" ? myTicketRow ?? myEndorsedRow : myRow;
  const isVolunteerCampaigner =
    election.office === "president" &&
    !!campaignRow &&
    !myTicketRow &&
    myEndorsedCandidateId === campaignRow.id;
  const canFileCandidacy = filingBlockReason === null;
  const hasPrimaryWinners = candidates.some((c) => c.primary_winner);
  const primaryPlayerCandidates = candidates.filter((c) => !c.is_npc);
  const partyNpcPlaceholders = candidates.filter((c) => c.is_npc);
  const generalCandidates = hasPrimaryWinners
    ? candidates.filter((c) => c.primary_winner)
    : candidates;
  const opponentAdTargets = generalCandidates
    .filter((c) => c.user_id !== userId && c.id !== campaignRow?.id)
    .map((c) => ({
      id: c.id,
      label: nameBy[c.user_id ?? ""]?.trim() || c.npc_name || c.id.slice(0, 8),
    }));

  const primaryPartyRestricted =
    election.primary_party_wide === false && election.office !== "president";
  const primaryOpenForPartyOnly = profileParty ?? null;

  // Leadership races: plain plurality share (no PVI, no campaign points). Seat/pres races: point-share only
  // blended FEC score. Both paths populate generalShareById so the SpreadBar + each card show
  // the same projected percentage.
  const generalScores = isLeadership
    ? computeLeadershipScores(generalCandidates, generalTally)
    : computeScores(generalCandidates, partisanLean, generalTally);
  const generalShareById: Record<string, number> = {};
  for (const s of generalScores) generalShareById[s.id] = s.share;

  // Live leader of the general: top projected share among nominees.
  let generalLeaderId: string | null = null;
  if (election.phase === "general" || election.phase === "closed") {
    let bestShare = -1;
    let tie = false;
    for (const c of generalCandidates) {
      const n = generalShareById[c.id] ?? 0;
      if (n > bestShare) {
        bestShare = n;
        generalLeaderId = c.id;
        tie = false;
      } else if (n === bestShare) {
        tie = true;
      }
    }
    if (tie) generalLeaderId = null;
  }

  const seatLabel = isLeadership
    ? leadershipMeta!.label
    : (election.district_code ?? election.state ?? "United States");

  const meta = partyMeta(profileParty ?? "");
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  const speechModerationElectionId = isAdmin ? election.id : null;

  return (
    <div className="space-y-8">
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
          {!isLeadership && election.office === "senate" && election.senate_class != null ? (
            <span className="rounded-full border border-indigo-400 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-950">
              Senate class {election.senate_class}
            </span>
          ) : null}
        </div>
        <h1 className="text-2xl font-semibold">{seatLabel}</h1>
        {viewerIsIncumbentForThisSenateSeat ? (
          <div className="rounded-lg border-2 border-amber-600/60 bg-amber-50 px-4 py-3 text-amber-950">
            <p className="text-sm font-semibold">Run for re-election</p>
            <p className="mt-1 text-xs leading-relaxed">
              You currently hold this state&apos;s Class {election.senate_class} Senate seat. This race is for the same
              class; filing and voting rules are unchanged.
            </p>
          </div>
        ) : null}
        {isLeadership ? (
          <p className="text-sm text-[var(--psc-muted)]">
            Leadership race — decided by a plain plurality of chamber votes. Winners gain the
            leadership role alongside their existing{" "}
            {election.office === "house" ? "representative" : "senator"} role.
          </p>
        ) : null}
        <div className="flex flex-col gap-4 border-t border-[var(--psc-border)] pt-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5 text-xs leading-relaxed text-[var(--psc-muted)]">
            <div>
              Filing: {new Date(election.filing_opens_at).toLocaleString()} —{" "}
              {new Date(election.filing_closes_at).toLocaleString()}
            </div>
            {!isLeadership && election.primary_closes_at ? (
              <div>Primary closes: {new Date(election.primary_closes_at).toLocaleString()}</div>
            ) : null}
            <div>General closes: {new Date(election.general_closes_at).toLocaleString()}</div>
          </div>
          {!isLeadership ? (
            <div className="shrink-0 sm:pl-6 sm:text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                Campaign ad spend
              </p>
              <p className="mt-0.5 font-mono text-2xl font-semibold tabular-nums text-[var(--psc-ink)]">
                {formatCampaignAdSpendUsd(totalCampaignAdSpendUsd)}
              </p>
              {totalCampaignAdsPlaced > 0 ? (
                <p className="mt-0.5 text-[10px] text-[var(--psc-muted)]">
                  {totalCampaignAdsPlaced.toLocaleString()} ad{totalCampaignAdsPlaced === 1 ? "" : "s"} ×{" "}
                  {formatCampaignAdSpendUsd(CAMPAIGN_AD_UNIT_PRICE)} each
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {election.phase === "closed" && (election.winner_user_id || winnerNpcName) ? (
        <section
          className={
            winnerNpcName
              ? "border-2 border-slate-500 bg-slate-50 p-6 text-slate-900"
              : "border-2 border-emerald-700 bg-emerald-50 p-6 text-emerald-950"
          }
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide">
            {winnerNpcName ? "Certified winner (NPC placeholder)" : "Certified winner"}
          </h2>
          <p className="mt-1 text-2xl font-semibold">
            {winnerNpcName ?? winnerName ?? election.winner_user_id}
          </p>
          {winnerNpcName ? (
            <p className="mt-2 text-sm text-slate-700">
              This seat is held symbolically — not a playable member of Congress. Player
              incumbents were vacated; the district record shows the NPC name for future races.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* FILING PHASE (dormant template: admins have not opened the window yet) */}
      {election.phase === "filing" && !filingWindowLive ? (
        <section className="space-y-4 border border-amber-300 bg-amber-50 p-6 text-amber-950">
          <h2 className="text-lg font-semibold">Filings not open yet</h2>
          <p className="mt-1 max-w-2xl text-sm">
            This seat exists as a template in the database. Players cannot file until an admin opens
            the filing window (scheduled times are applied then).
          </p>
          {isAdmin ? (
            <div className="mt-4">
              <OpenSeatFilingForm electionId={election.id} />
            </div>
          ) : (
            <p className="mt-2 text-xs">Ask a staff admin to open this race when you are ready.</p>
          )}
        </section>
      ) : null}

      {/* FILING PHASE */}
      {election.phase === "filing" && filingWindowLive ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
            <div className="min-w-0 max-w-2xl">
              <h2 className="text-lg font-semibold">Filing window</h2>
            </div>
            <div className="flex flex-col items-stretch gap-2">
              {myRow ? (
                <div className="flex w-full max-w-xs flex-col gap-2">
                  <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    You&apos;re filed as{" "}
                    <strong>{partyMeta(myRow.party).label}</strong>.
                  </p>
                  <WithdrawFilingForm electionId={election.id} />
                  <p className="text-[10px] text-[var(--psc-muted)]">
                    Withdraw if you want to file for a different House district, Senate seat, or
                    switch between House and Senate.
                  </p>
                </div>
              ) : !filingOpen ? (
                <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Filing is not open right now.
                </p>
              ) : canFileCandidacy ? (
                <form action={fileCandidacy}>
                  <input type="hidden" name="election_id" value={election.id} />
                  <SubmitButton pendingLabel="Filing…">File as {meta.label}</SubmitButton>
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
              electionOffice={election.office}
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
              myEndorsedCandidateId={null}
              myEndorsementPoints={0}
              allowGeneralBallot={false}
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
              <strong>{partyMeta(profileParty ?? "").label}</strong>. Party members vote for
              their nominee. Win the primary to replace your party&apos;s NPC placeholder on
              the general ballot — the other party&apos;s NPC always runs in November.
              {primaryPartyRestricted ? (
                <> This primary is limited to players whose Character record matches this seat.</>
              ) : (
                <> This primary is open party-wide.</>
              )}
            </p>
          </div>
          {partyNpcPlaceholders.length > 0 ? (
            <div className="rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/40 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                Party NPC placeholders
              </h3>
              <p className="mt-1 text-xs text-[var(--psc-muted)]">
                Each major party starts with a synthetic nominee. A player primary winner
                replaces their party&apos;s NPC.
              </p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {partyNpcPlaceholders.map((npc) => (
                  <li
                    key={npc.id}
                    className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-2 text-sm"
                  >
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${partyMeta(npc.party).pill}`}>
                      {partyMeta(npc.party).label}
                    </span>
                    <span className="ml-2 font-medium text-[var(--psc-ink)]">
                      {displayName(npc, candidateCardByUserId[npc.user_id ?? ""], nameBy)}
                    </span>
                    <span className="ml-2 text-xs text-[var(--psc-muted)]">
                      {Math.round(Number(npc.campaign_points_total ?? 0))} pts baseline
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <PartyGroupedCandidates
            candidates={primaryPlayerCandidates}
            electionOffice={election.office}
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
            emptyMessage="No players filed for this race yet."
            emphasizeParty
            myEndorsedCandidateId={null}
            myEndorsementPoints={0}
            allowGeneralBallot={false}
          />
        </section>
      ) : null}

      {/* GENERAL PHASE */}
      {election.phase === "general" ? (
        <section className="space-y-4">
          {election.office !== "president" ? (
            <SpreadBar
              scores={generalScores}
              nameBy={nameBy}
              candidateCardByUserId={candidateCardByUserId}
            />
          ) : null}
          {!isLeadership &&
          campaignRow &&
          (campaignRow.primary_winner || !hasPrimaryWinners) ? (
            <CampaignPanel
              election={election}
              myCandidate={campaignRow}
              isVolunteer={isVolunteerCampaigner}
              userId={userId}
              myRalliesInWindow={myRalliesInWindow}
              myRallyLimit={10}
              myRallyWindowHours={3}
              myNextRallyAt={myNextRallyAt}
              speechCount={speechCountBy[campaignRow.id] ?? 0}
              rallyCount={rallyCountBy[campaignRow.id] ?? 0}
              states={states}
              partisanLean={partisanLean}
              opponentCandidates={opponentAdTargets}
              adsInventory={adsInventory}
            />
          ) : null}
          <div className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
            <h2 className="text-lg font-semibold">
              {isLeadership ? "Chamber vote" : "General election"}
            </h2>
            {isLeadership ? (
              <p className="mt-1 text-sm text-[var(--psc-muted)]">
                Vote once per race — you can vote for yourself. Only{" "}
                {election.office === "house" ? "representatives" : "senators"}
                {leadershipMeta?.restricted_party
                  ? ` in the ${leadershipMeta.restricted_party} caucus`
                  : ""}{" "}
                can cast a ballot. The winner is the candidate with the most votes; ties go to the
                earliest filer.
              </p>
            ) : null}
          </div>
          <PartyGroupedCandidates
            candidates={generalCandidates}
            electionOffice={election.office}
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
            voteDisabled={!generalOpen || (isLeadership && !canCastLeadershipGeneralVote)}
            emptyMessage="No candidates on the general ballot."
            emphasizeParty
            myEndorsedCandidateId={myEndorsedCandidateId}
            myEndorsementPoints={myEndorsementPoints}
            allowGeneralBallot={isLeadership}
          />
          {npcActivity.length > 0 && (election.phase === "general" || election.phase === "closed") ? (
            <section className="space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                  Opponent activity
                </h3>
                <span className="text-xs text-[var(--psc-muted)]">Speeches & ads every 3h</span>
              </div>
              <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
                {npcActivity.map((row) => (
                  <li key={row.id} className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/40 px-3 py-2">
                    <p className="text-[var(--psc-ink)]">{row.message}</p>
                    <p className="mt-1 text-[10px] text-[var(--psc-muted)]">
                      {new Date(row.created_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {speechArchive?.length ? (
            <CampaignSpeechArchive
              speeches={speechArchive}
              adminDeleteElectionId={speechModerationElectionId}
              title="Campaign speech archive"
            />
          ) : speechFeed.length ? (
            <section className="space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                  Campaign speech feed
                </h3>
                <span className="text-xs text-[var(--psc-muted)]">
                  Latest {speechFeed.length} speeches
                </span>
              </div>
              <ul className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
                {speechFeed.map((speech, idx) => {
                  const target = candidateById.get(speech.candidateId);
                  const targetName = target
                    ? displayName(target, candidateCardByUserId[target.user_id ?? ""], nameBy)
                    : speech.candidateId.slice(0, 8);
                  const authorName =
                    candidateCardByUserId[speech.authorId]?.character_name?.trim() ||
                    nameBy[speech.authorId]?.trim() ||
                    speech.authorId.slice(0, 8);
                  return (
                    <li
                      key={`${speech.createdAt}:${speech.authorId}:${idx}`}
                      className="space-y-1 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/40 p-3"
                    >
                      <p className="text-[11px] text-[var(--psc-muted)]">
                        <span className="font-semibold text-[var(--psc-ink)]">{authorName}</span>{" "}
                        speaking for{" "}
                        <span className="font-semibold text-[var(--psc-ink)]">{targetName}</span>
                        {speech.targetState ? ` · ${speech.targetState}` : ""} ·{" "}
                        {new Date(speech.createdAt).toLocaleString()}
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-[var(--psc-ink)]">
                        {speech.content}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          <AdSpendFeedSection
            adSpendFeed={adSpendFeed}
            candidateById={candidateById}
            candidateCardByUserId={candidateCardByUserId}
            nameBy={nameBy}
            listKeyPrefix="ad"
          />
          {pacFilings ? (
            <ElectionPacFilings
              bundle={pacFilings}
              electionOffice={election.office}
              listKeyPrefix="general-pac"
            />
          ) : null}
        </section>
      ) : null}

      {/* CLOSED PHASE (final roster) */}
      {election.phase === "closed" ? (
        <section className="space-y-3">
          {election.office !== "president" ? (
            <SpreadBar
              scores={generalScores}
              nameBy={nameBy}
              candidateCardByUserId={candidateCardByUserId}
            />
          ) : null}
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Final roster
          </h3>
          <PartyGroupedCandidates
            candidates={candidates}
            electionOffice={election.office}
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
            myEndorsedCandidateId={null}
            myEndorsementPoints={0}
            allowGeneralBallot={false}
          />
          {speechArchive?.length ? (
            <CampaignSpeechArchive
              speeches={speechArchive}
              adminDeleteElectionId={speechModerationElectionId}
              title="Campaign speech archive"
            />
          ) : null}
          <AdSpendFeedSection
            adSpendFeed={adSpendFeed}
            candidateById={candidateById}
            candidateCardByUserId={candidateCardByUserId}
            nameBy={nameBy}
            listKeyPrefix="closed-ad"
          />
          {pacFilings ? (
            <ElectionPacFilings
              bundle={pacFilings}
              electionOffice={election.office}
              listKeyPrefix="closed-pac"
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
