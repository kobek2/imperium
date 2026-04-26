import Link from "next/link";
import { billStatusDisplay } from "@/lib/bill-display-status";
import type { AuthorBillVote, RecentAuthoredBill } from "@/lib/profile-recent-bills";

function voteLabel(v: string) {
  const u = v.toUpperCase();
  if (u === "YEA" || u === "NAY" || u === "ABSTAIN" || u === "PRESENT") return u;
  return v;
}

function chamberVoteLine(votes: AuthorBillVote[], billId: string) {
  const house = votes.find((x) => x.bill_id === billId && x.chamber === "house");
  const senate = votes.find((x) => x.bill_id === billId && x.chamber === "senate");
  const parts: string[] = [];
  parts.push(house ? `House ${voteLabel(house.vote)}` : "House —");
  parts.push(senate ? `Senate ${voteLabel(senate.vote)}` : "Senate —");
  return parts.join(" · ");
}

export function RecentAuthoredBillsPanel({
  bills,
  votes,
  heading = "Recent filings",
  caption,
}: {
  bills: RecentAuthoredBill[];
  votes: AuthorBillVote[];
  heading?: string;
  caption?: string;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">{heading}</h2>
        {caption ? <p className="mt-1 text-xs text-[var(--psc-muted)]">{caption}</p> : null}
      </div>
      {bills.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-panel)]/60 p-4 text-sm italic text-[var(--psc-muted)]">
          No bills filed yet.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--psc-border)] rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]">
          {bills.map((b) => (
            <li key={b.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    {billStatusDisplay(b.status)}
                  </p>
                  <p className="text-sm font-semibold text-[var(--psc-ink)]">
                    <Link href={`/bill/${b.id}`} className="hover:underline">
                      {b.title}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
                    {b.originating_chamber === "house" ? "House" : "Senate"} · Filed{" "}
                    {new Date(b.created_at).toLocaleDateString()}
                  </p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
                    {chamberVoteLine(votes, b.id)}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
