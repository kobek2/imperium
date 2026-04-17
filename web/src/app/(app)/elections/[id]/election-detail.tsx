import Link from "next/link";
import {
  castGeneralVote,
  castPrimaryVote,
  fileCandidacy,
} from "@/app/actions/elections";
import {
  getFilingEligibilityMessage,
  type ActiveCandidacySlots,
  type ProfileSeatFields,
} from "@/lib/election-filing";

type ElectionRow = {
  id: string;
  office: string;
  state: string | null;
  district_code: string | null;
  phase: string;
  filing_opens_at: string;
  filing_closes_at: string;
  primary_closes_at: string;
  general_closes_at: string;
  winner_user_id: string | null;
  /** When true (default), any same-party member may vote in this primary regardless of residence. */
  primary_party_wide?: boolean | null;
};

type CandRow = {
  id: string;
  user_id: string;
  party: string;
  campaign_points_total: number | null;
  primary_winner: boolean | null;
};

type CandidateCardFields = {
  character_name: string | null;
  face_claim_url: string | null;
  residence_state: string | null;
  home_district_code: string | null;
};

function partyLabel(p: string) {
  if (p === "democrat") return "Democratic";
  if (p === "republican") return "Republican";
  if (p === "independent") return "Independent";
  return p;
}

function seatLine(card: CandidateCardFields | undefined) {
  const st = (card?.residence_state ?? "").trim().toUpperCase();
  const dist = (card?.home_district_code ?? "").trim();
  if (dist) return `${st || "—"} · ${dist}`;
  if (st) return st;
  return "—";
}

function displayName(card: CandidateCardFields | undefined, userId: string, nameBy: Record<string, string>) {
  const n = card?.character_name?.trim() || nameBy[userId]?.trim();
  return n || userId.slice(0, 8);
}

function faceUrlOk(url: string | null | undefined) {
  const u = (url ?? "").trim();
  return u.startsWith("http://") || u.startsWith("https://");
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function ElectionDetail({
  election,
  candidates,
  nameBy,
  candidateCardByUserId,
  primaryTally,
  myPrimaryCandidateId,
  myGeneralCandidateId,
  profileParty,
  profileForFiling,
  activeSlots,
  userId,
  isAdmin,
  winnerName,
}: {
  election: ElectionRow;
  candidates: CandRow[];
  nameBy: Record<string, string>;
  candidateCardByUserId: Record<string, CandidateCardFields>;
  primaryTally: Record<string, number>;
  /** Your current primary ballot in this race, if any. */
  myPrimaryCandidateId: string | null;
  /** Your current general ballot in this race, if any. */
  myGeneralCandidateId: string | null;
  profileParty: string | null;
  profileForFiling: ProfileSeatFields | null;
  activeSlots: ActiveCandidacySlots;
  userId: string;
  isAdmin: boolean;
  winnerName: string | null;
}) {
  const now = new Date();
  const filingOpen =
    election.phase === "filing" &&
    now >= new Date(election.filing_opens_at) &&
    now <= new Date(election.filing_closes_at);
  const primaryOpen =
    election.phase === "primary" && now <= new Date(election.primary_closes_at);
  const generalOpen =
    election.phase === "general" && now <= new Date(election.general_closes_at);

  const myRow = candidates.find((c) => c.user_id === userId);
  const filingEligibilityMessage = getFilingEligibilityMessage(
    election.office,
    { state: election.state, district_code: election.district_code },
    profileForFiling,
    activeSlots,
  );
  const canFileCandidacy = filingEligibilityMessage === null;
  const hasPrimaryWinners = candidates.some((c) => c.primary_winner);
  const generalCandidates = hasPrimaryWinners
    ? candidates.filter((c) => c.primary_winner)
    : candidates;

  const primaryPartyCandidates =
    election.phase === "primary" && primaryOpen ? candidates.filter((c) => c.party === profileParty) : [];
  const primaryPartyVoteTotal = primaryPartyCandidates.reduce((s, c) => s + (primaryTally[c.id] ?? 0), 0);

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

      <header className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          {election.phase}
        </p>
        <h1 className="text-2xl font-semibold">
          {election.district_code ?? election.state ?? "United States"} · {election.office}
        </h1>
        <dl className="mt-4 grid gap-2 text-xs text-[var(--psc-muted)] sm:grid-cols-2">
          <div>
            Filing: {new Date(election.filing_opens_at).toLocaleString()} —{" "}
            {new Date(election.filing_closes_at).toLocaleString()}
          </div>
          <div>Primary closes: {new Date(election.primary_closes_at).toLocaleString()}</div>
          <div>General closes: {new Date(election.general_closes_at).toLocaleString()}</div>
        </dl>
      </header>

      {election.phase !== "closed" ? (
        <aside className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 text-sm text-[var(--psc-muted)]">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)]">
            How you use this race
          </h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              <strong>Filing</strong>: While filing is open, use <strong>File candidacy</strong>. Your ballot
              party is taken from your Character page; House and Senate seats must match your home district or
              residence state. You may only have one active congressional filing at a time, but you may also
              file for President alongside that seat. FEC-style point totals only affect <strong>general</strong>{" "}
              certification, not the primary.
            </li>
            <li>
              <strong>Primary</strong>: <strong>Player votes only</strong> — same-party ballot on this site.
              {election.primary_party_wide !== false ? (
                <>
                  {" "}
                  This race uses a <strong>party-wide</strong> primary: you may vote here even if this
                  seat is not where your character lives, so your party can pick nominees in other
                  districts. You may vote for yourself if you are on the ballot.
                </>
              ) : (
                <>
                  {" "}
                  This race limits primary ballots to players whose <strong>Character</strong> home
                  district (House) or residence state (Senate) matches this seat — except you may always
                  vote for <strong>yourself</strong> if you are a candidate here.
                </>
              )}{" "}
              After the primary deadline, each party&apos;s nominee is whoever got the most site votes in
              that party (ties broken deterministically); the race then moves to general automatically.
              Campaign points are not used in the primary.
            </li>
            <li>
              <strong>General</strong>: Cast your site vote here. For House and Senate, certification blends{" "}
              community votes with campaign points (60/40). House seats also apply the district&apos;s
              partisan lean at certify time.
            </li>
          </ol>
        </aside>
      ) : null}

      {election.phase === "closed" && election.winner_user_id ? (
        <section className="border-2 border-green-900 bg-green-50 p-6 text-green-950">
          <h2 className="text-lg font-semibold">Certified winner</h2>
          <p className="mt-2 text-xl font-semibold">{winnerName ?? election.winner_user_id}</p>
        </section>
      ) : null}

      {election.phase === "filing" && filingOpen && !myRow ? (
        <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <h2 className="text-lg font-semibold">File for this office</h2>
          <p className="mt-1 text-sm text-[var(--psc-muted)]">
            Declare a party for this run. It should match how you caucus in Discord primaries.
          </p>
          <form action={fileCandidacy} className="mt-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="election_id" value={election.id} />
            <label className="grid gap-1 text-sm font-semibold">
              Party for this race
              <select name="party" className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal">
                <option value="democrat">Democratic Party</option>
                <option value="republican">Republican Party</option>
                <option value="independent">Independent</option>
              </select>
            </label>
            <button
              type="submit"
              className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white"
            >
              File candidacy
            </button>
          </form>
        </section>
      ) : null}

      {election.phase === "filing" && myRow && filingOpen ? (
        <p className="text-sm text-[var(--psc-muted)]">
          You are filed as <strong>{myRow.party}</strong> for this race. When the filing window ends, the race
          moves to <strong>primary</strong> automatically (reload the page if it does not update right away).
        </p>
      ) : null}

      {election.phase === "primary" && primaryOpen ? (
        <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <h2 className="text-lg font-semibold">Primary ballot</h2>
          <p className="mt-1 text-sm text-[var(--psc-muted)]">
            Your profile party is <strong>{profileParty ?? "—"}</strong>. You only see{" "}
            <strong>your party’s</strong> candidates for this seat (other parties’ primaries are hidden).
            You may vote for yourself if you are filed here. The primary is decided from{" "}
            <strong>these votes only</strong> (no campaign-point scoring).
            {election.primary_party_wide !== false || election.office === "president" ? (
              <> This primary is open to your party nationwide — you do not need to live in this district.</>
            ) : (
              <>
                {" "}
                This primary is limited to players whose Character record matches this seat (except
                candidates may vote for themselves).
              </>
            )}
          </p>
          <ul className="mt-4 space-y-3">
            {candidates
              .filter((c) => c.party === profileParty)
              .map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border border-[var(--psc-border)] px-3 py-2">
                  <span className="font-semibold">{nameBy[c.user_id] ?? c.user_id.slice(0, 8)}</span>
                  <form action={castPrimaryVote}>
                    <input type="hidden" name="election_id" value={election.id} />
                    <input type="hidden" name="candidate_id" value={c.id} />
                    <button
                      type="submit"
                      className="border border-[var(--psc-border)] px-3 py-1 text-xs font-semibold uppercase"
                    >
                      Vote
                    </button>
                  </form>
                </li>
              ))}
          </ul>
          {candidates.filter((c) => c.party === profileParty).length === 0 ? (
            <p className="mt-3 text-sm text-[var(--psc-muted)]">
              No candidates in your party yet, or your profile party is not set. Update your character
              party on the Character page.
            </p>
          ) : null}
        </section>
      ) : null}

      {election.phase === "general" && generalOpen ? (
        <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <h2 className="text-lg font-semibold">General election</h2>
          <p className="mt-1 text-sm text-[var(--psc-muted)]">
            One vote per race. Unlike the primary, the general uses <strong>votes plus campaign points</strong>{" "}
            (60/40) when an admin finalizes House and Senate races. President is finalized manually by
            admins.
          </p>
          <ul className="mt-4 space-y-3">
            {generalCandidates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border border-[var(--psc-border)] px-3 py-2">
                <div>
                  <span className="font-semibold">{nameBy[c.user_id] ?? c.user_id.slice(0, 8)}</span>
                  <span className="ml-2 text-sm text-[var(--psc-muted)]">{c.party}</span>
                  <span className="ml-2 font-mono text-xs text-[var(--psc-muted)]">
                    campaign pts {Number(c.campaign_points_total ?? 0)}
                  </span>
                </div>
                <form action={castGeneralVote}>
                  <input type="hidden" name="election_id" value={election.id} />
                  <input type="hidden" name="candidate_id" value={c.id} />
                  <button
                    type="submit"
                    className="border border-[var(--psc-border)] px-3 py-1 text-xs font-semibold uppercase"
                  >
                    Vote
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {election.phase === "filing" && !filingOpen && !myRow ? (
        <p className="text-sm text-amber-800">Filing is not open at this time.</p>
      ) : null}
      {election.phase === "filing" && !filingOpen && myRow ? (
        <p className="text-sm text-[var(--psc-muted)]">
          Filing has closed and you remain on the ballot. This page should switch to <strong>primary</strong>{" "}
          automatically; refresh if you still see &quot;filing&quot; in the header after a few seconds.
        </p>
      ) : null}
      {election.phase === "primary" && !primaryOpen ? (
        <p className="text-sm text-[var(--psc-muted)]">
          Primary voting has ended. The race moves to <strong>general</strong> automatically; refresh if the
          header still says primary.
        </p>
      ) : null}
      {election.phase === "general" && !generalOpen ? (
        <p className="text-sm text-[var(--psc-muted)]">General voting is closed.</p>
      ) : null}
    </div>
  );
}
