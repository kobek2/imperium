import Link from "next/link";
import { redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import { leadershipReviewBill } from "@/app/actions/bills";
import { SubmitButton } from "@/components/submit-button";
import { processBillDeadlines } from "@/lib/bill-pipeline";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { canReviewLeadershipForChamber } from "@/lib/role-capabilities";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

export default async function LeadershipInboxPage() {
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
  const houseOk = canReviewLeadershipForChamber(roleKeys, "house");
  const senateOk = canReviewLeadershipForChamber(roleKeys, "senate");
  const isRep = roleKeys.includes("representative");
  const isSen = roleKeys.includes("senator");
  if (!houseOk && !senateOk && !isRep && !isSen) {
    redirect("/congress");
  }

  await processBillDeadlines(supabase);
  await runElectionPhaseSchedule(supabase);

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

  // Primary query includes the deadline column. Older databases that were seeded from an
  // outdated version of FULL_SETUP_PASTE_IN_DASHBOARD.sql won't have it yet, so we retry
  // without that column instead of rendering a silent empty inbox.
  type HopperRow = {
    id: string;
    title: string;
    content_md: string;
    originating_chamber: "house" | "senate";
    created_at: string;
    leadership_deadline_at: string | null;
    author_id: string;
  };
  let queue: HopperRow[] | null = null;
  let schemaWarning: string | null = null;
  {
    const primary = await supabase
      .from("bills")
      .select(
        "id, title, content_md, originating_chamber, created_at, leadership_deadline_at, author_id",
      )
      .eq("status", "hopper")
      .order("created_at", { ascending: true });
    if (primary.error) {
      const msg = (primary.error.message ?? "").toLowerCase();
      if (msg.includes("leadership_deadline_at") || msg.includes("chamber_vote_deadline_at")) {
        schemaWarning =
          "bills.leadership_deadline_at is missing. Run: alter table public.bills add column if not exists leadership_deadline_at timestamptz, add column if not exists chamber_vote_deadline_at timestamptz;";
        const retry = await supabase
          .from("bills")
          .select("id, title, content_md, originating_chamber, created_at, author_id")
          .eq("status", "hopper")
          .order("created_at", { ascending: true });
        queue = (retry.data ?? []).map((r) => ({ ...r, leadership_deadline_at: null })) as HopperRow[];
      } else {
        throw new Error(primary.error.message);
      }
    } else {
      queue = (primary.data ?? []) as HopperRow[];
    }
  }

  const visible =
    queue?.filter((b) => {
      if (b.originating_chamber === "house") return houseOk;
      if (b.originating_chamber === "senate") return senateOk;
      return false;
    }) ?? [];

  return (
    <div className="space-y-8">
      <Link href="/congress" className="text-sm font-semibold text-[var(--psc-accent)]">
        ← Congress
      </Link>
      <header>
        <h1 className="text-3xl font-semibold">Leadership inbox</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--psc-muted)]">
          Accept to send a bill to the chamber floor for 24 hours, or reject to kill it. No action
          before the deadline also kills the bill.
        </p>
      </header>

      {schemaWarning ? (
        <div className="border border-amber-700 bg-amber-50 p-4 text-xs text-amber-900">
          <strong>Schema out of date:</strong> {schemaWarning}
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

      {!visible.length && !visibleSessions.length ? (
        <p className="text-sm text-[var(--psc-muted)]">No bills awaiting your chamber.</p>
      ) : !visible.length ? null : (
        <ul className="space-y-6">
          {visible.map((bill) => (
            <li
              key={bill.id}
              className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm"
            >
              <p className="text-xs font-semibold uppercase text-[var(--psc-muted)]">
                {bill.originating_chamber} · deadline {fmt(bill.leadership_deadline_at)}
              </p>
              <h2 className="mt-1 text-lg font-semibold">{bill.title}</h2>
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-[var(--psc-border)] bg-white p-3 text-xs">
                {bill.content_md}
              </pre>
              <div className="mt-4 flex flex-wrap gap-2">
                <form action={leadershipReviewBill}>
                  <input type="hidden" name="bill_id" value={bill.id} />
                  <input type="hidden" name="decision" value="accept" />
                  <SubmitButton
                    pendingLabel="Accepting…"
                    className="border border-green-900 bg-green-950 px-4 py-2 text-xs font-semibold uppercase text-white transition hover:brightness-110"
                  >
                    Accept → floor (24h)
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
