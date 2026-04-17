import Link from "next/link";
import { redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import { castBillVote, submitBill } from "@/app/actions/bills";
import { processBillDeadlines } from "@/lib/bill-pipeline";
import { canFileFederalLegislation, originatingChamberForRoles } from "@/lib/legislative-eligibility";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { canReviewAnyChamberLeadership } from "@/lib/role-capabilities";

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const canFile = canFileFederalLegislation(roleKeys);
  const origin = originatingChamberForRoles(roleKeys);
  const leadershipNav = canReviewAnyChamberLeadership(roleKeys);

  const { data: bills } = await supabase
    .from("bills")
    .select(
      "id, title, status, originating_chamber, created_at, expires_at, leadership_deadline_at, chamber_vote_deadline_at",
    )
    .neq("status", "dead")
    .order("created_at", { ascending: false });

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
        {!bills?.length ? (
          <p className="text-sm text-[var(--psc-muted)]">No open bills.</p>
        ) : (
          <div className="space-y-6">
            {bills.map((bill) => (
              <article
                key={bill.id}
                className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                      {bill.status.replaceAll("_", " ")}
                    </p>
                    <h3 className="text-lg font-semibold">{bill.title}</h3>
                    <p className="mt-1 text-xs text-[var(--psc-muted)]">
                      Filed {fmt(bill.created_at)} · Originating {bill.originating_chamber}
                    </p>
                    {bill.status === "hopper" && bill.leadership_deadline_at ? (
                      <p className="mt-1 text-xs font-semibold text-amber-900">
                        Leadership deadline: {fmt(bill.leadership_deadline_at)}
                      </p>
                    ) : null}
                    {(bill.status === "house_floor" || bill.status === "senate_floor") &&
                    bill.chamber_vote_deadline_at ? (
                      <p className="mt-1 text-xs font-semibold text-green-900">
                        Floor vote closes: {fmt(bill.chamber_vote_deadline_at)}
                      </p>
                    ) : null}
                  </div>
                </div>

                {bill.status === "house_floor" ? (
                  <form action={castBillVote} className="mt-4 border border-dashed border-[var(--psc-border)] p-3">
                    <p className="text-xs font-semibold uppercase text-[var(--psc-muted)]">House floor vote</p>
                    <input type="hidden" name="bill_id" value={bill.id} />
                    <input type="hidden" name="chamber" value="house" />
                    <div className="mt-2 flex gap-2">
                      {(["yea", "nay", "abstain"] as const).map((vote) => (
                        <button
                          key={vote}
                          type="submit"
                          name="vote"
                          value={vote}
                          className="flex-1 border border-[var(--psc-border)] px-2 py-1 text-xs font-semibold uppercase"
                        >
                          {vote}
                        </button>
                      ))}
                    </div>
                  </form>
                ) : null}

                {bill.status === "senate_floor" ? (
                  <form action={castBillVote} className="mt-4 border border-dashed border-[var(--psc-border)] p-3">
                    <p className="text-xs font-semibold uppercase text-[var(--psc-muted)]">Senate floor vote</p>
                    <input type="hidden" name="bill_id" value={bill.id} />
                    <input type="hidden" name="chamber" value="senate" />
                    <div className="mt-2 flex gap-2">
                      {(["yea", "nay", "abstain"] as const).map((vote) => (
                        <button
                          key={vote}
                          type="submit"
                          name="vote"
                          value={vote}
                          className="flex-1 border border-[var(--psc-border)] px-2 py-1 text-xs font-semibold uppercase"
                        >
                          {vote}
                        </button>
                      ))}
                    </div>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
