import Link from "next/link";
import { castBillVote } from "@/app/actions/bills";
import { BillBody } from "@/components/bill-body";
import { BillVoteCountdown } from "@/components/bill-vote-countdown";
import { SubmitButton } from "@/components/submit-button";
import { billStatusDisplay } from "@/lib/bill-display-status";

export type VoteKind = "yea" | "nay" | "abstain" | "present";
export type BillVote = {
  bill_id: string;
  voter_id: string;
  chamber: "house" | "senate";
  vote: VoteKind;
};

export type VoterProfile = {
  id: string;
  character_name: string | null;
  party: string | null;
};

export type BillForCard = {
  id: string;
  title: string;
  /** Rich HTML from the bill editor when present. */
  content_html?: string | null;
  /** Markdown / plain (legacy bills, nominations). */
  content_md?: string | null;
  status: string;
  originating_chamber: "house" | "senate";
  created_at: string;
  leadership_deadline_at: string | null;
  chamber_vote_deadline_at: string | null;
  vp_tie_break_pending?: boolean | null;
};

const VOTE_ORDER: readonly VoteKind[] = ["yea", "nay", "abstain", "present"] as const;

function fmt(ts: string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function partyDotClass(p: string | null | undefined) {
  if (p === "democrat") return "bg-blue-600";
  if (p === "republican") return "bg-red-600";
  if (p === "independent") return "bg-slate-700";
  return "bg-slate-300";
}

const VOTE_META: Record<VoteKind, {
  label: string;
  short: string;
  bar: string;
  text: string;
  activeBtn: string;
  idleBtn: string;
  badge: string;
}> = {
  yea: {
    label: "Yea",
    short: "Y",
    bar: "bg-green-600",
    text: "text-green-900",
    activeBtn:
      "flex-1 border border-green-700 bg-green-700 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-white shadow-sm",
    idleBtn:
      "flex-1 border border-green-700 bg-white px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-green-900 transition hover:bg-green-50",
    badge: "bg-green-100 text-green-900 border border-green-300",
  },
  nay: {
    label: "Nay",
    short: "N",
    bar: "bg-red-600",
    text: "text-red-900",
    activeBtn:
      "flex-1 border border-red-700 bg-red-700 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-white shadow-sm",
    idleBtn:
      "flex-1 border border-red-700 bg-white px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-red-900 transition hover:bg-red-50",
    badge: "bg-red-100 text-red-900 border border-red-300",
  },
  abstain: {
    label: "Abstain",
    short: "A",
    bar: "bg-amber-500",
    text: "text-amber-900",
    activeBtn:
      "flex-1 border border-amber-600 bg-amber-500 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-white shadow-sm",
    idleBtn:
      "flex-1 border border-amber-600 bg-white px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-900 transition hover:bg-amber-50",
    badge: "bg-amber-100 text-amber-900 border border-amber-300",
  },
  present: {
    label: "Present",
    short: "P",
    bar: "bg-slate-400",
    text: "text-slate-900",
    activeBtn:
      "flex-1 border border-slate-600 bg-slate-500 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-white shadow-sm",
    idleBtn:
      "flex-1 border border-slate-600 bg-white px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-900 transition hover:bg-slate-50",
    badge: "bg-slate-100 text-slate-900 border border-slate-300",
  },
};

function TallyBar({ counts }: { counts: Record<VoteKind, number> }) {
  const total = counts.yea + counts.nay + counts.abstain;
  if (total === 0) {
    return (
      <div className="h-2 w-full overflow-hidden rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)]" />
    );
  }
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)]">
      {VOTE_ORDER.map((v) => {
        const pct = (counts[v] / total) * 100;
        if (pct <= 0) return null;
        return (
          <div
            key={v}
            className={VOTE_META[v].bar}
            style={{ width: `${pct}%` }}
            title={`${VOTE_META[v].label}: ${counts[v]}`}
          />
        );
      })}
    </div>
  );
}

function countsFor(votes: BillVote[]): Record<VoteKind, number> {
  const c: Record<VoteKind, number> = { yea: 0, nay: 0, abstain: 0, present: 0 };
  for (const v of votes) {
    if (v.vote === "yea" || v.vote === "nay" || v.vote === "abstain" || v.vote === "present") {
      c[v.vote]++;
    }
  }
  return c;
}

function RollCall({
  votes,
  voterById,
}: {
  votes: BillVote[];
  voterById: Map<string, VoterProfile>;
}) {
  const grouped: Record<VoteKind, BillVote[]> = { yea: [], nay: [], abstain: [], present: [] };
  for (const v of votes) grouped[v.vote].push(v);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {VOTE_ORDER.map((k) => {
        const list = grouped[k];
        const meta = VOTE_META[k];
        return (
          <div
            key={k}
            className="min-w-0 border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-3"
          >
            <p
              className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${meta.text}`}
            >
              {meta.label} · {list.length}
            </p>
            {list.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--psc-muted)]">None.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs">
                {list.map((v) => {
                  const p = voterById.get(v.voter_id);
                  const name = p?.character_name?.trim() || "Unknown member";
                  return (
                    <li
                      key={`${v.voter_id}-${k}`}
                      className="flex min-w-0 items-center gap-2"
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${partyDotClass(p?.party)}`}
                        aria-hidden
                      />
                      <Link
                        href={`/profile/${v.voter_id}`}
                        className="truncate text-[var(--psc-ink)] hover:underline"
                      >
                        {name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FloorVoteForm({
  bill,
  chamber,
  myVote,
  disabled,
  disabledReason,
}: {
  bill: BillForCard;
  chamber: "house" | "senate";
  myVote: VoteKind | null;
  disabled: boolean;
  disabledReason?: string;
}) {
  return (
    <form
      action={castBillVote}
      className="mt-4 border border-dashed border-[var(--psc-border)] p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          {chamber === "house" ? "House" : "Senate"} floor vote
        </p>
        {myVote ? (
          <p className="text-xs text-[var(--psc-muted)]">
            Your vote:{" "}
            <span
              className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${VOTE_META[myVote].badge}`}
            >
              {VOTE_META[myVote].label}
            </span>
            <span className="ml-2">· click another button to change.</span>
          </p>
        ) : disabled ? null : (
          <p className="text-xs text-[var(--psc-muted)]">Tap to cast your vote.</p>
        )}
      </div>
      <input type="hidden" name="bill_id" value={bill.id} />
      <input type="hidden" name="chamber" value={chamber} />
      <div className="mt-2 flex gap-2">
        {VOTE_ORDER.map((vote) => {
          const isActive = myVote === vote;
          const meta = VOTE_META[vote];
          return (
            <SubmitButton
              key={vote}
              name="vote"
              value={vote}
              pendingLabel="…"
              disabled={disabled || isActive}
              title={disabled ? disabledReason : isActive ? "This is your current vote" : undefined}
              className={isActive ? meta.activeBtn : meta.idleBtn}
            >
              {meta.label}
            </SubmitButton>
          );
        })}
      </div>
      {disabled && disabledReason ? (
        <p className="mt-2 text-[10px] italic text-[var(--psc-muted)]">{disabledReason}</p>
      ) : null}
    </form>
  );
}

export function BillCard({
  bill,
  votes,
  voterById,
  userId,
  userChambers,
  isPresidentialRunningMate = false,
  canBreakSenateTie = false,
  /** When true, floor vote forms are omitted unless the viewer may cast that vote (cleaner observe-only UX). */
  suppressVoteForms = false,
}: {
  bill: BillForCard;
  votes: BillVote[];
  voterById: Map<string, VoterProfile>;
  userId: string;
  /** Chambers the viewer holds a floor-voting role in. */
  userChambers: Array<"house" | "senate">;
  isPresidentialRunningMate?: boolean;
  canBreakSenateTie?: boolean;
  suppressVoteForms?: boolean;
}) {
  const houseVotes = votes.filter((v) => v.chamber === "house");
  const senateVotes = votes.filter((v) => v.chamber === "senate");

  const myHouseVote =
    (houseVotes.find((v) => v.voter_id === userId)?.vote as VoteKind | undefined) ?? null;
  const mySenateVote =
    (senateVotes.find((v) => v.voter_id === userId)?.vote as VoteKind | undefined) ?? null;

  const houseCounts = countsFor(houseVotes);
  const senateCounts = countsFor(senateVotes);

  const showHouseForm = bill.status === "house_floor";
  const showSenateForm = bill.status === "senate_floor";

  const canCastHouseFloorVote = userChambers.includes("house");
  const canCastSenateFloorVote = bill.vp_tie_break_pending
    ? canBreakSenateTie
    : userChambers.includes("senate") && !isPresidentialRunningMate;

  const showHouseVoteUi =
    showHouseForm && (!suppressVoteForms || canCastHouseFloorVote);
  const showSenateVoteUi =
    showSenateForm && (!suppressVoteForms || canCastSenateFloorVote);

  return (
    <article className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            {billStatusDisplay(bill.status)}
          </p>
          <h3 className="text-lg font-semibold text-[var(--psc-ink)]">
            <Link href={`/bill/${bill.id}`} className="hover:underline">
              {bill.title}
            </Link>
          </h3>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Filed {fmt(bill.created_at)} · Originating chamber:{" "}
            <span className="font-semibold text-[var(--psc-ink)]">
              {bill.originating_chamber === "house" ? "House" : "Senate"}
            </span>
          </p>
          {bill.status === "submitted" && bill.leadership_deadline_at ? (
            <p className="mt-1 text-xs font-semibold text-amber-900">
              Leadership review deadline: {fmt(bill.leadership_deadline_at)}
            </p>
          ) : null}
          {bill.status === "on_docket" ? (
            <p className="mt-1 text-xs font-semibold text-[var(--psc-ink)]">
              On the leadership docket — floor vote has not been opened yet.
            </p>
          ) : null}
          {bill.vp_tie_break_pending && bill.status === "senate_floor" ? (
            <p className="mt-1 text-xs font-semibold text-[var(--psc-ink)]">
              Senate vote tied — Vice President or a presidential running mate may cast the
              tie-breaker.
            </p>
          ) : null}
          {(bill.status === "house_floor" || bill.status === "senate_floor") &&
          bill.chamber_vote_deadline_at ? (
            <BillVoteCountdown endsAtIso={bill.chamber_vote_deadline_at} />
          ) : null}
        </div>
      </div>

      <BillBody content_html={bill.content_html} content_md={bill.content_md} />

      {houseVotes.length > 0 ||
      senateVotes.length > 0 ||
      showHouseForm ||
      showSenateForm ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {houseVotes.length > 0 || showHouseForm ? (
            <TallyCard
              chamber="house"
              counts={houseCounts}
              myVote={myHouseVote}
              isActive={showHouseForm}
            />
          ) : null}
          {senateVotes.length > 0 || showSenateForm ? (
            <TallyCard
              chamber="senate"
              counts={senateCounts}
              myVote={mySenateVote}
              isActive={showSenateForm}
            />
          ) : null}
        </div>
      ) : null}

      {showHouseVoteUi ? (
        <FloorVoteForm
          bill={bill}
          chamber="house"
          myVote={myHouseVote}
          disabled={!canCastHouseFloorVote}
          disabledReason="Only House members may cast this vote."
        />
      ) : null}
      {showSenateVoteUi ? (
        <FloorVoteForm
          bill={bill}
          chamber="senate"
          myVote={mySenateVote}
          disabled={
            bill.vp_tie_break_pending
              ? !canBreakSenateTie
              : !userChambers.includes("senate") || isPresidentialRunningMate
          }
          disabledReason={
            bill.vp_tie_break_pending
              ? "Only the Vice President or a presidential running mate (during the primary) may cast a tie-breaking vote."
              : isPresidentialRunningMate
                ? "Presidential running mates may only vote to break a Senate tie."
                : "Only Senators may cast this vote."
          }
        />
      ) : null}

      {houseVotes.length + senateVotes.length > 0 ? (
        <details className="mt-4 border-t border-dashed border-[var(--psc-border)] pt-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)] hover:text-[var(--psc-ink)]">
            Roll call ({houseVotes.length + senateVotes.length})
          </summary>
          <div className="mt-3 space-y-4">
            {houseVotes.length > 0 ? (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--psc-muted)]">
                  House ({houseVotes.length})
                </p>
                <RollCall votes={houseVotes} voterById={voterById} />
              </div>
            ) : null}
            {senateVotes.length > 0 ? (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--psc-muted)]">
                  Senate ({senateVotes.length})
                </p>
                <RollCall votes={senateVotes} voterById={voterById} />
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function TallyCard({
  chamber,
  counts,
  myVote,
  isActive,
}: {
  chamber: "house" | "senate";
  counts: Record<VoteKind, number>;
  myVote: VoteKind | null;
  isActive: boolean;
}) {
  const total = counts.yea + counts.nay + counts.abstain;
  const margin = counts.yea - counts.nay;
  return (
    <div className="border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--psc-muted)]">
          {chamber === "house" ? "House tally" : "Senate tally"}{" "}
          {isActive ? (
            <span className="ml-1 rounded-full border border-[var(--psc-border)] bg-white px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--psc-ink)]">
              live
            </span>
          ) : null}
        </p>
        <p className="font-mono text-[10px] text-[var(--psc-muted)]">
          {total} cast · margin {margin >= 0 ? "+" : ""}
          {margin}
        </p>
      </div>
      <div className="mt-2">
        <TallyBar counts={counts} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
        {VOTE_ORDER.map((v) => (
          <span
            key={v}
            className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide ${VOTE_META[v].badge}`}
          >
            {VOTE_META[v].label} {counts[v]}
          </span>
        ))}
      </div>
      {myVote ? (
        <p className="mt-2 text-[10px] text-[var(--psc-muted)]">
          You voted{" "}
          <strong className={VOTE_META[myVote].text}>{VOTE_META[myVote].label}</strong>.
        </p>
      ) : null}
    </div>
  );
}
