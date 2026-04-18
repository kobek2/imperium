import Link from "next/link";
import { redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import { leadershipReviewBill } from "@/app/actions/bills";
import { SubmitButton } from "@/components/submit-button";
import { processBillDeadlines } from "@/lib/bill-pipeline";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { canReviewLeadershipForChamber } from "@/lib/role-capabilities";

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
  if (!houseOk && !senateOk) {
    redirect("/congress");
  }

  await processBillDeadlines(supabase);

  const { data: queue } = await supabase
    .from("bills")
    .select(
      "id, title, content_md, originating_chamber, created_at, leadership_deadline_at, author_id",
    )
    .eq("status", "hopper")
    .order("created_at", { ascending: true });

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

      {!visible.length ? (
        <p className="text-sm text-[var(--psc-muted)]">No bills awaiting your chamber.</p>
      ) : (
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
