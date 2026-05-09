import Link from "next/link";
import { billStatusDisplay, billTerminalOutcomeExplanation } from "@/lib/bill-display-status";
import type { BillFloorYeaNayTally } from "@/lib/bill-types";
import type { AuthorBillVote, RecentAuthoredBill } from "@/lib/profile-recent-bills";

function voteLabel(v: string) {
  const u = v.toUpperCase();
  if (u === "YEA" || u === "NAY" || u === "ABSTAIN" || u === "PRESENT") return u;
  return v;
}

function formatFloorTally(yea: number, nay: number): string {
  if (yea + nay === 0) return "—";
  return `${yea}–${nay}`;
}

function chamberTallyLine(tallies: Map<string, BillFloorYeaNayTally>, billId: string) {
  const t = tallies.get(billId);
  const hy = t?.house_yea ?? 0;
  const hn = t?.house_nay ?? 0;
  const sy = t?.senate_yea ?? 0;
  const sn = t?.senate_nay ?? 0;
  return `House ${formatFloorTally(hy, hn)} · Senate ${formatFloorTally(sy, sn)}`;
}

function chamberVoteLine(votes: AuthorBillVote[], billId: string) {
  const house = votes.find((x) => x.bill_id === billId && x.chamber === "house");
  const senate = votes.find((x) => x.bill_id === billId && x.chamber === "senate");
  const parts: string[] = [];
  parts.push(house ? `Your House vote: ${voteLabel(house.vote)}` : "Your House vote: —");
  parts.push(senate ? `Your Senate vote: ${voteLabel(senate.vote)}` : "Your Senate vote: —");
  return parts.join(" · ");
}

export function RecentAuthoredBillsPanel({
  bills,
  votes,
  floorTallies,
  confirmationBillIds = new Set<string>(),
  rejectionActorDisplayByBillId = new Map<string, string | null>(),
  heading = "Recent filings",
  caption,
}: {
  bills: RecentAuthoredBill[];
  votes: AuthorBillVote[];
  floorTallies: Map<string, BillFloorYeaNayTally>;
  confirmationBillIds?: Set<string>;
  rejectionActorDisplayByBillId?: Map<string, string | null>;
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
          {bills.map((b) => {
            const tally =
              floorTallies.get(b.id) ??
              ({ house_yea: 0, house_nay: 0, senate_yea: 0, senate_nay: 0 } satisfies BillFloorYeaNayTally);
            const outcome = billTerminalOutcomeExplanation(b.status, {
              originatingChamber: b.originating_chamber,
              floorTally: tally,
              isAppointmentConfirmationBill: confirmationBillIds.has(b.id),
              rejectionActorDisplay: rejectionActorDisplayByBillId.get(b.id) ?? null,
            });
            return (
              <li key={b.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                      {billStatusDisplay(b.status, { originatingChamber: b.originating_chamber })}
                    </p>
                    {outcome ? (
                      <p className="mt-0.5 text-xs leading-snug text-[var(--psc-ink)]">{outcome}</p>
                    ) : null}
                    <p className="text-sm font-semibold text-[var(--psc-ink)]">
                      <Link href={`/bill/${b.id}`} className="hover:underline">
                        {b.title}
                      </Link>
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-[var(--psc-muted)]">
                      {chamberTallyLine(floorTallies, b.id)}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
                      {chamberVoteLine(votes, b.id)}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
