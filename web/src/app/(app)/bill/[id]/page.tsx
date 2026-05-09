import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { leadershipCloseBillFloorVotePeriod, leadershipOpenFloorVote, otherChamberLeadershipReviewBill } from "@/app/actions/bills";
import { setBillWhipInstruction } from "@/app/actions/whips";
import { getServerAuth } from "@/lib/supabase/server";
import { processBillDeadlines } from "@/lib/bill-pipeline";
import { billStatusDisplay, billTerminalOutcomeExplanation } from "@/lib/bill-display-status";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { canAcceptRejectHopperForChamber, canLeadershipEditBillContent } from "@/lib/role-capabilities";
import {
  isDebateStatus,
  leadershipEditChamberForBillStatus,
  receivingChamberForOrigination,
} from "@/lib/legislative-helpers";
import { BillBody } from "@/components/bill-body";
import { BillVoteCountdown } from "@/components/bill-vote-countdown";
import { SubmitButton } from "@/components/submit-button";
import { legacyMdToEditorHtml } from "@/lib/sanitize-bill-html";
import { BillLeadershipEditForm } from "./bill-leadership-edit-form";
import { BillAmendmentsPanel, type AmendmentRow } from "./bill-amendments-panel";

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to view bills.
      </div>
    );
  }

  if (!user) redirect("/login");

  await processBillDeadlines(supabase);

  const { data: bill } = await supabase
    .from("bills")
    .select(
      "id, title, content_html, content_md, status, originating_chamber, created_at, leadership_deadline_at, chamber_vote_deadline_at, vp_tie_break_pending, author_id, policy_tags, template_id, rejection_actor_id, rejection_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!bill) notFound();

  const { data: authorProfile } = await supabase
    .from("profiles")
    .select("id, character_name, discord_username")
    .eq("id", bill.author_id)
    .maybeSingle();

  const authorDisplay =
    authorProfile?.character_name?.trim() ||
    authorProfile?.discord_username?.trim() ||
    "Member";

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role, party")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const chamber = bill.originating_chamber as "house" | "senate";
  const editChamber = leadershipEditChamberForBillStatus(String(bill.status), chamber);
  const canEdit =
    editChamber != null &&
    canLeadershipEditBillContent(roleKeys, editChamber) &&
    !["law", "vetoed", "dead", "failed", "rejected"].includes(String(bill.status));

  const versionsRes = await supabase
    .from("bill_versions")
    .select("id, content_html, created_at, edited_by")
    .eq("bill_id", id)
    .order("created_at", { ascending: false })
    .limit(12);

  const versionRows = (versionsRes.error ? [] : (versionsRes.data ?? [])) as Array<{
    id: string;
    content_html: string;
    created_at: string;
    edited_by: string;
  }>;

  const fmt = (ts: string) => new Date(ts).toLocaleString();

  const initialHtml =
    (bill as { content_html?: string | null }).content_html?.trim() ||
    legacyMdToEditorHtml((bill as { content_md?: string | null }).content_md) ||
    null;

  const { data: amendRows } = await supabase
    .from("bill_amendments")
    .select("id, title, description, amended_text, status, proposed_at, proposed_by, notes")
    .eq("bill_id", id)
    .order("proposed_at", { ascending: false });

  const amendments = (amendRows ?? []) as AmendmentRow[];

  const st = String(bill.status);
  const rejectionActorId = String((bill as { rejection_actor_id?: string | null }).rejection_actor_id ?? "").trim();
  const rejectionAtIso = String((bill as { rejection_at?: string | null }).rejection_at ?? "").trim();

  const { data: rejectorProfile } = rejectionActorId
    ? await supabase.from("profiles").select("character_name, discord_username").eq("id", rejectionActorId).maybeSingle()
    : { data: null as { character_name?: string | null; discord_username?: string | null } | null };

  const rejectionActorDisplay =
    rejectorProfile?.character_name?.trim() ||
    rejectorProfile?.discord_username?.trim() ||
    (rejectionActorId ? "Unknown member" : null);

  const terminalStatuses = new Set(["rejected", "expired", "vetoed", "dead", "failed"]);
  let billTerminalOutcome: string | null = null;
  if (terminalStatuses.has(st)) {
    const [{ data: outcomeVotes }, { data: apptForBill }] = await Promise.all([
      supabase.from("bill_votes").select("chamber, vote").eq("bill_id", id).in("vote", ["yea", "nay"]),
      supabase.from("appointments").select("id").eq("confirmation_bill_id", id).maybeSingle(),
    ]);
    const floorTally = { house_yea: 0, house_nay: 0, senate_yea: 0, senate_nay: 0 };
    for (const v of outcomeVotes ?? []) {
      const row = v as { chamber: string; vote: string };
      if (row.chamber === "house" && row.vote === "yea") floorTally.house_yea++;
      else if (row.chamber === "house" && row.vote === "nay") floorTally.house_nay++;
      else if (row.chamber === "senate" && row.vote === "yea") floorTally.senate_yea++;
      else if (row.chamber === "senate" && row.vote === "nay") floorTally.senate_nay++;
    }
    billTerminalOutcome = billTerminalOutcomeExplanation(st, {
      originatingChamber: chamber,
      floorTally,
      isAppointmentConfirmationBill: Boolean(apptForBill),
      rejectionActorDisplay: rejectionActorId ? rejectionActorDisplay : null,
    });
  }

  const receiving = receivingChamberForOrigination(chamber);
  const canOtherChamberReview =
    bill.status === "other_chamber_review" && canAcceptRejectHopperForChamber(roleKeys, receiving);

  const editChamberForDebate = leadershipEditChamberForBillStatus(String(bill.status), chamber);
  const canResolveAmendments =
    editChamberForDebate != null && canAcceptRejectHopperForChamber(roleKeys, editChamberForDebate);
  const isAuthor = bill.author_id === user.id;
  const canProposeAmendment =
    isDebateStatus(String(bill.status)) &&
    (isAuthor ||
      (editChamberForDebate != null && canLeadershipEditBillContent(roleKeys, editChamberForDebate)));

  const canOpenFloor =
    (bill.status === "on_docket" || bill.status === "debate" || bill.status === "other_chamber_debate") &&
    (() => {
      const floorChamber =
        bill.status === "other_chamber_debate" ? receiving : chamber;
      return canAcceptRejectHopperForChamber(roleKeys, floorChamber);
    })();

  const whipChamber = bill.status === "house_floor" ? "house" : bill.status === "senate_floor" ? "senate" : null;
  const canSetWhip =
    whipChamber === "house"
      ? roleKeys.some((k) =>
          ["admin", "speaker", "house_majority_leader", "house_majority_whip", "house_minority_leader", "house_minority_whip"].includes(k),
        )
      : whipChamber === "senate"
        ? roleKeys.some((k) =>
            [
              "admin",
              "senate_majority_leader",
              "senate_majority_whip",
              "senate_minority_leader",
              "senate_minority_whip",
            ].includes(k),
          )
        : false;
  const floorVoteClockActive =
    (bill.status === "house_floor" || bill.status === "senate_floor") &&
    Boolean(bill.chamber_vote_deadline_at) &&
    !bill.vp_tie_break_pending &&
    new Date(String(bill.chamber_vote_deadline_at)) > new Date();
  const { data: whipRows } = await supabase
    .from("bill_whip_instructions")
    .select("party, instructed_vote, rationale, set_at, set_by")
    .eq("bill_id", id)
    .eq("chamber", whipChamber ?? chamber)
    .order("set_at", { ascending: false });
  const viewerParty = String((profile as { party?: string | null } | null)?.party ?? "").trim().toLowerCase();
  const viewerWhip = (whipRows ?? []).find((w) => String((w as { party?: string }).party ?? "").toLowerCase() === viewerParty) as
    | { instructed_vote?: string; rationale?: string | null; set_at?: string }
    | undefined;

  const closeFloorChamber = bill.status === "house_floor" ? "house" : bill.status === "senate_floor" ? "senate" : null;
  const canCloseFloorVote =
    closeFloorChamber != null &&
    floorVoteClockActive &&
    canAcceptRejectHopperForChamber(roleKeys, closeFloorChamber);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2 border-b border-[var(--psc-border)] pb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          {billStatusDisplay(String(bill.status), { originatingChamber: chamber })}
        </p>
        <h1 className="text-3xl font-semibold text-[var(--psc-ink)]">{bill.title}</h1>
        <p className="text-sm text-[var(--psc-muted)]">
          Chamber:{" "}
          <strong className="text-[var(--psc-ink)]">
            {bill.originating_chamber === "house" ? "House" : "Senate"}
          </strong>
          {" · "}
          Filed {fmt(bill.created_at)}
        </p>
        <p className="text-sm text-[var(--psc-muted)]">
          Proposed by{" "}
          <Link href={`/profile/${bill.author_id}`} className="font-semibold text-[var(--psc-ink)] hover:underline">
            {authorDisplay}
          </Link>
        </p>
        {billTerminalOutcome ? (
          <p className="text-sm font-medium leading-snug text-[var(--psc-ink)]">{billTerminalOutcome}</p>
        ) : null}
        {rejectionActorId && rejectionActorDisplay ? (
          <p className="text-sm text-[var(--psc-muted)]">
            Leadership actor:{" "}
            <Link href={`/profile/${rejectionActorId}`} className="font-semibold text-[var(--psc-ink)] hover:underline">
              {rejectionActorDisplay}
            </Link>
            {rejectionAtIso ? <span className="font-mono text-xs"> · {fmt(rejectionAtIso)}</span> : null}
          </p>
        ) : null}
        {bill.status === "leadership_review" ? (
          <p className="text-sm font-semibold text-[var(--psc-ink)]">
            Leadership review — the Speaker or Majority Leader (and Deputy after 12h) must accept or reject before the
            automatic debate window.
          </p>
        ) : null}
        {bill.status === "on_docket" ? (
          <p className="text-sm font-semibold text-[var(--psc-ink)]">
            On the leadership docket — floor vote has not been opened yet.
          </p>
        ) : null}
        {bill.status === "debate" ? (
          <p className="text-sm font-semibold text-[var(--psc-ink)]">
            Debate phase — resolve amendments, then leadership may open a floor vote.
          </p>
        ) : null}
        {bill.status === "other_chamber_review" ? (
          <p className="text-sm font-semibold text-[var(--psc-ink)]">
            Awaiting {receiving === "house" ? "House" : "Senate"} leadership review.
          </p>
        ) : null}
        {bill.status === "other_chamber_debate" ? (
          <p className="text-sm font-semibold text-[var(--psc-ink)]">
            {receiving === "house" ? "House" : "Senate"} debate — amendments may be proposed here before a floor vote.
          </p>
        ) : null}
        {bill.vp_tie_break_pending && bill.status === "senate_floor" ? (
          <p className="text-sm font-semibold text-[var(--psc-ink)]">
            Senate vote tied — Vice President or a presidential running mate may cast the tie-breaker.
          </p>
        ) : null}
        {(bill.status === "house_floor" || bill.status === "senate_floor") && bill.chamber_vote_deadline_at ? (
          <BillVoteCountdown endsAtIso={bill.chamber_vote_deadline_at} />
        ) : null}
      </header>

      {canCloseFloorVote ? (
        <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 text-sm text-[var(--psc-ink)]">
          <h2 className="text-sm font-semibold">Close floor vote</h2>
          <form action={leadershipCloseBillFloorVotePeriod} className="mt-3">
            <input type="hidden" name="bill_id" value={bill.id} />
            <SubmitButton
              pendingLabel="Closing vote…"
              className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white"
            >
              Close vote now
            </SubmitButton>
          </form>
        </section>
      ) : null}

      <BillBody content_html={bill.content_html} content_md={bill.content_md} />

      {canSetWhip ? (
        <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
          <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Whip vote</h2>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Send a caucus-wide whip call for your party ({whipChamber === "house" ? "House" : "Senate"} floor). Members
            receive an inbox notification.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {viewerWhip?.set_at ? (
              <p className="text-xs text-[var(--psc-muted)]">Last updated {fmt(viewerWhip.set_at)}</p>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <form action={setBillWhipInstruction}>
              <input type="hidden" name="bill_id" value={bill.id} />
              <input type="hidden" name="instructed_vote" value="yea" />
              <SubmitButton className="rounded border border-emerald-700 bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">
                Whip Aye
              </SubmitButton>
            </form>
            <form action={setBillWhipInstruction}>
              <input type="hidden" name="bill_id" value={bill.id} />
              <input type="hidden" name="instructed_vote" value="nay" />
              <SubmitButton className="rounded border border-rose-700 bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white">
                Whip Nay
              </SubmitButton>
            </form>
          </div>
          <form action={setBillWhipInstruction} className="hidden">
            <input type="hidden" name="bill_id" value={bill.id} />
            <input type="hidden" name="party" value={viewerParty || "independent"} />
          </form>
        </section>
      ) : null}

      {canOtherChamberReview ? (
        <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
          <h2 className="text-sm font-semibold text-[var(--psc-ink)]">
            {receiving === "house" ? "House" : "Senate"} leadership
          </h2>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Accept to move to debate in the {receiving === "house" ? "House" : "Senate"}, or reject to end the bill.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={otherChamberLeadershipReviewBill}>
              <input type="hidden" name="bill_id" value={bill.id} />
              <input type="hidden" name="decision" value="accept" />
              <SubmitButton className="rounded border border-green-700 bg-green-700 px-3 py-1.5 text-xs font-semibold text-white">
                Accept to docket
              </SubmitButton>
            </form>
            <form action={otherChamberLeadershipReviewBill}>
              <input type="hidden" name="bill_id" value={bill.id} />
              <input type="hidden" name="decision" value="reject" />
              <SubmitButton className="rounded border border-red-700 bg-white px-3 py-1.5 text-xs font-semibold text-red-800">
                Reject
              </SubmitButton>
            </form>
          </div>
        </section>
      ) : null}

      {canOpenFloor ? (
        <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
          <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Open floor vote</h2>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            {bill.status === "debate" || bill.status === "other_chamber_debate"
              ? "Debate-phase votes run for 24 hours once opened."
              : "Choose how long the live floor vote stays open."}
          </p>
          <form action={leadershipOpenFloorVote} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="bill_id" value={bill.id} />
            {bill.status === "on_docket" ? (
              <>
                <label className="text-xs font-semibold">
                  Hours
                  <select name="duration_preset" className="ml-1 border border-[var(--psc-border)] bg-white px-2 py-1">
                    <option value="24">24</option>
                    <option value="48">48</option>
                    <option value="72">72</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>
                <label className="text-xs font-semibold">
                  Custom
                  <input name="duration_custom_hours" className="ml-1 w-16 border border-[var(--psc-border)] px-1" />
                </label>
              </>
            ) : (
              <input type="hidden" name="duration_preset" value="24" />
            )}
            <SubmitButton className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-1.5 text-xs font-semibold text-white">
              Push to vote
            </SubmitButton>
          </form>
        </section>
      ) : null}

      <BillAmendmentsPanel
        billId={bill.id}
        status={String(bill.status)}
        amendments={amendments}
        canPropose={canProposeAmendment}
        canResolve={canResolveAmendments}
        initialBillHtml={initialHtml}
      />

      {canEdit ? (
        <BillLeadershipEditForm billId={bill.id} initialHtml={initialHtml} />
      ) : null}

      {versionRows.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Edit history</h2>
          <ul className="space-y-2 text-xs text-[var(--psc-muted)]">
            {versionRows.map((v) => (
              <li key={v.id} className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-2">
                <span className="font-mono">{fmt(v.created_at)}</span> · editor{" "}
                <Link href={`/profile/${v.edited_by}`} className="font-semibold text-[var(--psc-accent)] underline">
                  profile
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export const dynamic = "force-dynamic";
