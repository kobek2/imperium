import Link from "next/link";
import { redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import { leadershipOpenFloorVote, leadershipReviewBill } from "@/app/actions/bills";
import { SubmitButton } from "@/components/submit-button";
import { BillBody } from "@/components/bill-body";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { canAcceptRejectHopperForChamber } from "@/lib/role-capabilities";

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

type BillRow = {
  id: string;
  title: string;
  content_md: string | null;
  content_html: string | null;
  originating_chamber: "house" | "senate";
  created_at: string;
  leadership_deadline_at: string | null;
  author_id: string;
};

export default async function LeadershipPage() {
  const supabase = await tryCreateClient();
  if (!supabase) redirect("/");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const canActHouse = canAcceptRejectHopperForChamber(roleKeys, "house");
  const canActSenate = canAcceptRejectHopperForChamber(roleKeys, "senate");

  const isRep = roleKeys.includes("representative");
  const isSen = roleKeys.includes("senator");

  const { data: leadershipSessions } = await supabase
    .from("leadership_sessions")
    .select("id, chamber, closes_at, opens_at")
    .eq("phase", "open");

  const userChambers: ("house" | "senate")[] = [];
  if (isRep) userChambers.push("house");
  if (isSen) userChambers.push("senate");
  const visibleSessions = (leadershipSessions ?? []).filter(
    (s) => userChambers.length === 0 || userChambers.includes(s.chamber),
  );

  const selectCols =
    "id, title, content_md, content_html, originating_chamber, created_at, leadership_deadline_at, author_id";

  let submitted: BillRow[] = [];
  let onDocket: BillRow[] = [];
  let schemaWarning: string | null = null;

  {
    const sub = await supabase
      .from("bills")
      .select(selectCols)
      .eq("status", "submitted")
      .order("created_at", { ascending: true });
    const dock = await supabase
      .from("bills")
      .select(selectCols)
      .eq("status", "on_docket")
      .order("created_at", { ascending: true });

    if (sub.error || dock.error) {
      const msg = (sub.error?.message ?? dock.error?.message ?? "").toLowerCase();
      if (msg.includes("submitted") || msg.includes("on_docket") || msg.includes("content_html")) {
        schemaWarning =
          "Run the latest database migrations (bill status `submitted` / `on_docket`, optional `content_html`).";
      } else if (msg.includes("leadership_deadline_at") || msg.includes("chamber_vote_deadline_at")) {
        schemaWarning =
          "bills.leadership_deadline_at is missing. Run the timer columns migration.";
      } else {
        throw new Error(sub.error?.message ?? dock.error?.message);
      }
    } else {
      submitted = (sub.data ?? []) as BillRow[];
      onDocket = (dock.data ?? []) as BillRow[];
    }
  }

  const hasQueue = submitted.length > 0 || onDocket.length > 0;

  return (
    <div className="space-y-8">
      <Link href="/congress" className="text-sm font-semibold text-[var(--psc-accent)] underline">
        ← Congress overview
      </Link>
      <header>
        <h1 className="text-3xl font-semibold">Leadership</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--psc-muted)]">
          <strong className="text-[var(--psc-ink)]">Review</strong> newly filed bills, then{" "}
          <strong className="text-[var(--psc-ink)]">place them on the docket</strong>. When you are ready,{" "}
          <strong className="text-[var(--psc-ink)]">open the floor vote</strong> and choose how long voting
          stays open. The <strong className="text-[var(--psc-ink)]">Speaker</strong> acts for House bills; the{" "}
          <strong className="text-[var(--psc-ink)]">Senate Majority Leader</strong> acts for Senate bills.
        </p>
      </header>

      {schemaWarning ? (
        <div className="border border-amber-700 bg-amber-50 p-4 text-xs text-amber-900">
          <strong>Schema:</strong> {schemaWarning}
        </div>
      ) : null}

      {visibleSessions.length ? (
        <section className="space-y-3 border border-amber-700 bg-amber-50 p-5">
          <h2 className="text-base font-semibold text-amber-900">
            Leadership election{visibleSessions.length === 1 ? "" : "s"} in session
          </h2>
          <ul className="space-y-2">
            {visibleSessions.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-amber-200 bg-white px-3 py-2"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--psc-ink)]">
                    {s.chamber === "house" ? "House" : "Senate"} leadership
                  </p>
                  <p className="text-xs text-[var(--psc-muted)]">Closes {new Date(s.closes_at).toLocaleString()}</p>
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

      {!hasQueue && !visibleSessions.length ? (
        <p className="text-sm text-[var(--psc-muted)]">No bills awaiting leadership action.</p>
      ) : null}

      {submitted.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">1 · Leadership review</h2>
          <p className="text-xs text-[var(--psc-muted)]">
            Accept to move a bill onto the chamber docket (not yet in voting). Reject to drop it.
          </p>
          <ul className="space-y-6">
            {submitted.map((bill) => {
              const canAct =
                (bill.originating_chamber === "house" && canActHouse) ||
                (bill.originating_chamber === "senate" && canActSenate);
              return (
                <li
                  key={bill.id}
                  className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm"
                >
                  <p className="text-xs font-semibold uppercase text-[var(--psc-muted)]">
                    {bill.originating_chamber === "house" ? "House" : "Senate"} · Submitted · deadline{" "}
                    {fmt(bill.leadership_deadline_at)}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold">
                    <Link href={`/bill/${bill.id}`} className="text-[var(--psc-ink)] hover:underline">
                      {bill.title}
                    </Link>
                  </h3>
                  <BillBody content_html={bill.content_html} content_md={bill.content_md} />
                  {canAct ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <form action={leadershipReviewBill}>
                        <input type="hidden" name="bill_id" value={bill.id} />
                        <input type="hidden" name="decision" value="accept" />
                        <SubmitButton
                          pendingLabel="Accepting…"
                          className="border border-green-900 bg-green-950 px-4 py-2 text-xs font-semibold uppercase text-white transition hover:brightness-110"
                        >
                          Accept → docket
                        </SubmitButton>
                      </form>
                      <form action={leadershipReviewBill}>
                        <input type="hidden" name="bill_id" value={bill.id} />
                        <input type="hidden" name="decision" value="reject" />
                        <SubmitButton
                          pendingLabel="Rejecting…"
                          className="border border-red-800 bg-red-950 px-4 py-2 text-xs font-semibold uppercase text-white transition hover:brightness-110"
                        >
                          Reject
                        </SubmitButton>
                      </form>
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-[var(--psc-muted)]">
                      {bill.originating_chamber === "house"
                        ? "Only the Speaker may accept or reject House bills in review."
                        : "Only the Senate Majority Leader may accept or reject Senate bills in review."}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {onDocket.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">2 · On docket — open voting</h2>
          <p className="text-xs text-[var(--psc-muted)]">
            When the chamber is ready, start the floor vote and set how long it stays open.
          </p>
          <ul className="space-y-6">
            {onDocket.map((bill) => {
              const canAct =
                (bill.originating_chamber === "house" && canActHouse) ||
                (bill.originating_chamber === "senate" && canActSenate);
              return (
                <li
                  key={bill.id}
                  className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm"
                >
                  <p className="text-xs font-semibold uppercase text-[var(--psc-muted)]">
                    {bill.originating_chamber === "house" ? "House" : "Senate"} · On docket
                  </p>
                  <h3 className="mt-1 text-lg font-semibold">
                    <Link href={`/bill/${bill.id}`} className="text-[var(--psc-ink)] hover:underline">
                      {bill.title}
                    </Link>
                  </h3>
                  <BillBody content_html={bill.content_html} content_md={bill.content_md} />
                  {canAct ? (
                    <form action={leadershipOpenFloorVote} className="mt-4 flex flex-wrap items-end gap-3">
                      <input type="hidden" name="bill_id" value={bill.id} />
                      <label className="grid gap-1 text-xs font-semibold text-[var(--psc-ink)]">
                        Duration
                        <select
                          name="duration_preset"
                          className="border border-[var(--psc-border)] bg-white px-2 py-2 text-sm font-normal"
                          defaultValue="24"
                        >
                          <option value="24">24 hours</option>
                          <option value="48">48 hours</option>
                          <option value="72">72 hours</option>
                          <option value="custom">Custom (hours)</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-[var(--psc-ink)]">
                        Custom hours
                        <input
                          name="duration_custom_hours"
                          placeholder="e.g. 36"
                          className="w-28 border border-[var(--psc-border)] bg-white px-2 py-2 text-sm font-normal"
                        />
                      </label>
                      <SubmitButton
                        pendingLabel="Opening…"
                        className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110"
                      >
                        Open floor vote
                      </SubmitButton>
                    </form>
                  ) : (
                    <p className="mt-4 text-xs text-[var(--psc-muted)]">
                      {bill.originating_chamber === "house"
                        ? "Only the Speaker may open a House floor vote."
                        : "Only the Senate Majority Leader may open a Senate floor vote."}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
