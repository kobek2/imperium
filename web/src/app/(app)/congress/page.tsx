import Link from "next/link";
import { redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import { submitBill } from "@/app/actions/bills";
import { processBillDeadlines } from "@/lib/bill-pipeline";
import { canFileFederalLegislation, originatingChamberForRoles } from "@/lib/legislative-eligibility";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { canReviewAnyChamberLeadership } from "@/lib/role-capabilities";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import {
  isActivePresidentialRunningMate,
  userCanBreakSenateTie,
} from "@/lib/presidential-running-mate";
import { BillCard, type BillVote, type VoterProfile } from "./bill-card";

export default async function CongressPage() {
  const supabase = await tryCreateClient();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to open the hopper.
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await processBillDeadlines(supabase);
  await runElectionPhaseSchedule(supabase);

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const canFile = canFileFederalLegislation(roleKeys);
  const origin = originatingChamberForRoles(roleKeys);
  const leadershipNav = canReviewAnyChamberLeadership(roleKeys);

  const [{ data: bills }, { data: leadershipSessions }, isRunningMate, canBreakSenateTie] =
    await Promise.all([
    supabase
      .from("bills")
      .select(
        "id, title, status, originating_chamber, created_at, expires_at, leadership_deadline_at, chamber_vote_deadline_at, vp_tie_break_pending",
      )
      .neq("status", "dead")
      .order("created_at", { ascending: false }),
    supabase
      .from("leadership_sessions")
      .select("id, chamber, closes_at")
      .eq("phase", "open"),
    isActivePresidentialRunningMate(supabase, user.id),
    userCanBreakSenateTie(supabase, user.id, roleKeys),
  ]);

  const billList = bills ?? [];
  const billIds = billList.map((b) => b.id);

  let votes: BillVote[] = [];
  if (billIds.length) {
    const { data: rawVotes } = await supabase
      .from("bill_votes")
      .select("bill_id, voter_id, chamber, vote")
      .in("bill_id", billIds);
    votes = (rawVotes ?? []) as BillVote[];
  }

  const voterIds = Array.from(new Set(votes.map((v) => v.voter_id)));
  const voterById = new Map<string, VoterProfile>();
  if (voterIds.length) {
    const { data: voterProfiles } = await supabase
      .from("profiles")
      .select("id, character_name, party")
      .in("id", voterIds);
    for (const p of (voterProfiles ?? []) as VoterProfile[]) voterById.set(p.id, p);
  }

  const votesByBill = new Map<string, BillVote[]>();
  for (const v of votes) {
    const list = votesByBill.get(v.bill_id) ?? [];
    list.push(v);
    votesByBill.set(v.bill_id, list);
  }

  const userChambers: ("house" | "senate")[] = [];
  if (roleKeys.includes("representative")) userChambers.push("house");
  if (roleKeys.includes("senator")) userChambers.push("senate");

  const relevantSessions = (leadershipSessions ?? []).filter(
    (s) => userChambers.length === 0 || userChambers.includes(s.chamber),
  );

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Congress</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--psc-muted)]">
            New bills wait up to <strong>12 hours</strong> for chamber leadership to schedule them. If
            leadership accepts, the originating chamber has <strong>24 hours</strong> to vote, then the
            other chamber, then the President. If leadership does nothing for 12 hours, the bill dies.
            Chamber members may change their vote until the window closes. New Congresses should elect
            chamber leadership roughly every two years (configure in Discord / grants).
          </p>
        </div>
        {leadershipNav ? (
          <Link
            href="/congress/leadership"
            className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white"
          >
            Leadership inbox
          </Link>
        ) : null}
      </header>

      {relevantSessions.length ? (
        <section className="space-y-3 border border-amber-700 bg-amber-50 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-amber-900">
              Leadership election{relevantSessions.length === 1 ? "" : "s"} in session
            </h2>
            <span className="text-xs text-amber-900">
              File + vote on chamber leadership.
            </span>
          </div>
          <ul className="space-y-2">
            {relevantSessions.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-amber-200 bg-white px-3 py-2"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--psc-ink)]">
                    {s.chamber === "house" ? "House" : "Senate"} leadership
                  </p>
                  <p className="text-xs text-[var(--psc-muted)]">
                    Closes {new Date(s.closes_at).toLocaleString()}
                  </p>
                </div>
                <Link
                  href={`/congress/leadership/session/${s.id}`}
                  className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110"
                >
                  Open ballot →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canFile && origin ? (
        <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <h2 className="text-lg font-semibold">File legislation</h2>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Bills are introduced in the <strong className="text-[var(--psc-ink)]">{origin}</strong> based
            on your seat (Representative → House, Senator → Senate, President → House by default).
          </p>
          <form action={submitBill} className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold md:col-span-2">
              Title
              <input
                name="title"
                required
                className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold md:col-span-2">
              Markdown body
              <textarea
                name="content_md"
                rows={6}
                required
                className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
              />
            </label>
            <button
              type="submit"
              className="border border-[var(--psc-border)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white md:col-span-2"
            >
              File bill
            </button>
          </form>
        </section>
      ) : (
        <p className="text-sm text-[var(--psc-muted)]">
          Filing unlocks when your profile has a <strong>Representative</strong>, <strong>Senator</strong>, or{" "}
          <strong>President</strong> role (via Discord role sync / grants).
        </p>
      )}

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Active docket</h2>
        {!billList.length ? (
          <p className="text-sm text-[var(--psc-muted)]">No open bills.</p>
        ) : (
          <div className="space-y-6">
            {billList.map((bill) => (
              <BillCard
                key={bill.id}
                bill={bill}
                votes={votesByBill.get(bill.id) ?? []}
                voterById={voterById}
                userId={user.id}
                userChambers={userChambers}
                isPresidentialRunningMate={isRunningMate}
                canBreakSenateTie={canBreakSenateTie}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
