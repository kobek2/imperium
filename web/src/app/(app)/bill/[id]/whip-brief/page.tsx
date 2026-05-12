import Link from "next/link";
import { notFound } from "next/navigation";
import type { BillChamber } from "@/lib/bill-types";
import { billStatusDisplay } from "@/lib/bill-display-status";
import { getServerAuth } from "@/lib/supabase/server";

const PARTY_SET = new Set(["democrat", "republican", "independent"]);
const VOTE_SET = new Set(["yea", "nay"]);

function partyLabel(p: string): string {
  if (p === "democrat") return "Democratic";
  if (p === "republican") return "Republican";
  if (p === "independent") return "Independent";
  return p;
}

function voteWord(v: string): string {
  return v === "nay" ? "NAY" : "AYE";
}

export default async function BillWhipBriefPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id: billId } = await params;
  const sp = await searchParams;
  const chamberRaw = typeof sp.chamber === "string" ? sp.chamber.trim().toLowerCase() : "";
  const partyRaw = typeof sp.party === "string" ? sp.party.trim().toLowerCase() : "";
  const voteRaw = typeof sp.instructed_vote === "string" ? sp.instructed_vote.trim().toLowerCase() : "";
  const issuerRaw = typeof sp.issuer === "string" ? sp.issuer.trim() : "";

  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) notFound();

  if (chamberRaw !== "house" && chamberRaw !== "senate") notFound();
  if (!PARTY_SET.has(partyRaw) || !VOTE_SET.has(voteRaw)) notFound();

  const chamber = chamberRaw as BillChamber;
  const instructedVote = voteRaw as "yea" | "nay";

  const { data: bill } = await supabase
    .from("bills")
    .select("id, title, status, originating_chamber, chamber_vote_deadline_at")
    .eq("id", billId)
    .maybeSingle();

  if (!bill) notFound();

  const title = String((bill as { title: string }).title);
  const status = String((bill as { status: string }).status);
  const floorLive = status === `${chamber}_floor`;
  const deadline = (bill as { chamber_vote_deadline_at: string | null }).chamber_vote_deadline_at;

  const actorParty = partyRaw;
  const actorPartyPretty = partyLabel(actorParty);

  const issuerName = issuerRaw.length > 0 ? issuerRaw.slice(0, 120) : "Chamber leadership";

  const chamberName = chamber === "house" ? "House" : "Senate";
  const voteWordUpper = voteWord(instructedVote);

  return (
    <article className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <header className="space-y-3 border-b border-[var(--psc-border)] pb-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">
          Floor dispatch · {chamberName} whip
        </p>
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-[var(--psc-ink)]">
          {chamberName} leadership instructs {actorPartyPretty} caucus: vote {voteWordUpper}
        </h1>
        <p className="text-sm text-[var(--psc-muted)]">
          {new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}{" "}
          · Guidance applies to the active roll call on{" "}
          <Link href={`/bill/${billId}`} className="font-semibold text-[var(--psc-accent)] underline">
            {title}
          </Link>
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Lede</h2>
        <p className="text-lg leading-relaxed text-[var(--psc-ink)]">
          <span className="font-semibold">CAPITOL</span> — {issuerName}, carrying the {chamberName} whip for the{" "}
          {actorPartyPretty} conference, circulated formal floor guidance instructing members to vote{" "}
          <strong>{voteWordUpper}</strong> on {title}. The notice lands as whips track attendance, watch the tally board,
          and prepare for possible reconsideration motions if the margin tightens.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">What this means</h2>
        <p className="text-base leading-relaxed text-[var(--psc-ink)]">
          Caucus instructions are not binding law, but they signal how leadership reads party strategy on this
          measure. Members who break a published whip risk intraparty friction and, in this simulation, can see small
          swings in public approval when votes diverge from guidance. The {actorPartyPretty} position on the floor is
          now recorded as <strong>{voteWordUpper}</strong> for this roll call unless leadership issues a revised notice.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Bill status</h2>
        <p className="text-base leading-relaxed text-[var(--psc-ink)]">
          The measure is currently <strong>{billStatusDisplay(status)}</strong>
          {floorLive ? (
            <>
              {" "}
              with an open {chamberName} vote
              {deadline ? (
                <>
                  {" "}
                  (clock:{" "}
                  <time dateTime={deadline}>{new Date(deadline).toLocaleString()}</time>)
                </>
              ) : null}
              .
            </>
          ) : (
            <>
              . The whip notice you opened was filed during a floor window; if the bill has advanced, treat this
              article as archival context and confirm the live question on the bill page.
            </>
          )}
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Sidebar</h2>
        <p className="text-sm leading-relaxed text-[var(--psc-muted)]">
          Whip counts are coordinated from the leadership desk; rank-and-file members should expect follow-up notes in
          cloakroom channels. When the presiding officer puts the question, the expected voice vote aligns with{" "}
          <strong>{voteWordUpper}</strong> for {actorPartyPretty} members unless a member announces intention to pair
          or take leave.
        </p>
      </section>

      <footer className="border-t border-[var(--psc-border)] pt-6 text-sm text-[var(--psc-muted)]">
        <Link href={`/bill/${billId}`} className="font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline">
          Open bill workspace →
        </Link>
        {" · "}
        <Link href="/congress" className="font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline">
          Congress overview
        </Link>
        {" · "}
        <Link href="/inbox" className="font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline">
          Inbox
        </Link>
      </footer>
    </article>
  );
}
