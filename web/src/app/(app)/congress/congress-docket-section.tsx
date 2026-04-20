import { BillCard, type BillForCard, type BillVote, type VoterProfile } from "./bill-card";

export function CongressDocketSection({
  sectionId,
  heading,
  subheading,
  shellClassName,
  headingClassName,
  bills,
  votesByBill,
  voterById,
  userId,
  userChambers,
  isRunningMate,
  canBreakSenateTie,
  suppressVoteForms = false,
  emptyLabel,
}: {
  sectionId: string;
  heading: string;
  subheading: string;
  shellClassName: string;
  headingClassName: string;
  bills: BillForCard[];
  votesByBill: Map<string, BillVote[]>;
  voterById: Map<string, VoterProfile>;
  userId: string;
  userChambers: Array<"house" | "senate">;
  isRunningMate: boolean;
  canBreakSenateTie: boolean;
  suppressVoteForms?: boolean;
  emptyLabel: string;
}) {
  return (
    <section className={`rounded-xl border-2 shadow-sm ${shellClassName}`} aria-labelledby={sectionId}>
      <header className={`border-b px-5 py-4 ${headingClassName}`}>
        <h2 id={sectionId} className="text-lg font-semibold tracking-tight">
          {heading}
        </h2>
        <p className="mt-1 text-sm leading-relaxed opacity-90">{subheading}</p>
      </header>
      <div className="space-y-6 p-5">
        {!bills.length ? (
          <p className="text-sm text-[var(--psc-muted)]">{emptyLabel}</p>
        ) : (
          bills.map((bill) => (
            <BillCard
              key={bill.id}
              bill={bill}
              votes={votesByBill.get(bill.id) ?? []}
              voterById={voterById}
              userId={userId}
              userChambers={userChambers}
              isPresidentialRunningMate={isRunningMate}
              canBreakSenateTie={canBreakSenateTie}
              suppressVoteForms={suppressVoteForms}
            />
          ))
        )}
      </div>
    </section>
  );
}
