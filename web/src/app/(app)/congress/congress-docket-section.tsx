import { BillCard, type BillForCard, type BillVote, type VoterProfile } from "./bill-card";
import { billNeedsViewerAttention } from "@/lib/congress-viewer-attention";

type StageBucketKey = "floor" | "debate" | "review" | "docket" | "submitted" | "other";

function stageForBillStatus(status: string): StageBucketKey {
  if (status === "house_floor" || status === "senate_floor") return "floor";
  if (status === "debate" || status === "other_chamber_debate") return "debate";
  if (status === "other_chamber_review" || status === "leadership_review") return "review";
  if (status === "on_docket") return "docket";
  if (status === "submitted") return "submitted";
  return "other";
}

export function CongressDocketSection({
  sectionId,
  chamber,
  heading,
  subheading,
  shellClassName,
  headingClassName,
  bills,
  votesByBill,
  voterById,
  userId,
  roleKeys,
  viewerParty,
  viewerWhipByBillId,
  userChambers,
  isRunningMate,
  canBreakSenateTie,
  suppressVoteForms = false,
  emptyLabel,
}: {
  sectionId: string;
  chamber: "house" | "senate";
  heading: string;
  subheading: string;
  shellClassName: string;
  headingClassName: string;
  bills: BillForCard[];
  votesByBill: Map<string, BillVote[]>;
  voterById: Map<string, VoterProfile>;
  userId: string;
  roleKeys: string[];
  viewerParty: string | null;
  viewerWhipByBillId: Map<string, "yea" | "nay">;
  userChambers: Array<"house" | "senate">;
  isRunningMate: boolean;
  canBreakSenateTie: boolean;
  suppressVoteForms?: boolean;
  emptyLabel: string;
}) {
  const stageOrder: StageBucketKey[] = ["floor", "debate", "review", "docket", "submitted", "other"];
  const stageMeta: Record<StageBucketKey, { title: string; hint: string }> = {
    floor: { title: "Live floor vote", hint: "Voting is open now" },
    debate: { title: "Debate", hint: "Amendments and floor scheduling" },
    review: { title: `${chamber === "house" ? "House" : "Senate"} leadership review`, hint: "Awaiting accept/reject decision" },
    docket: { title: "On docket", hint: "Queued for floor vote open" },
    submitted: { title: "Submitted", hint: "New filing in hopper queue" },
    other: { title: "Other active status", hint: "" },
  };

  const grouped = new Map<StageBucketKey, BillForCard[]>();
  for (const bill of bills) {
    const bucket = stageForBillStatus(bill.status);
    grouped.set(bucket, [...(grouped.get(bucket) ?? []), bill]);
  }

  return (
    <section className={`rounded-xl border-2 shadow-sm ${shellClassName}`} aria-labelledby={sectionId}>
      <header className={`border-b px-5 py-4 ${headingClassName}`}>
        <h2 id={sectionId} className="text-lg font-semibold tracking-tight">
          {heading}
        </h2>
        {subheading ? <p className="mt-1 text-sm leading-relaxed opacity-90">{subheading}</p> : null}
      </header>
      <div className="space-y-6 p-5">
        {!bills.length ? (
          <p className="text-sm text-[var(--psc-muted)]">{emptyLabel}</p>
        ) : (
          stageOrder.map((bucket) => {
            const stageBills = grouped.get(bucket) ?? [];
            if (!stageBills.length) return null;
            const meta = stageMeta[bucket];
            return (
              <section key={bucket} className="space-y-3">
                <div className="flex items-center justify-between gap-2 border-b border-dashed border-[var(--psc-border)] pb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)]">
                    {meta.title}
                    <span className="ml-2 rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2 py-0.5 text-[10px] font-semibold text-[var(--psc-muted)]">
                      {stageBills.length}
                    </span>
                  </p>
                  {meta.hint ? <p className="text-[11px] text-[var(--psc-muted)]">{meta.hint}</p> : null}
                </div>
                <div className="space-y-3">
                  {stageBills.map((bill) => {
                    const votes = votesByBill.get(bill.id) ?? [];
                    const showAttentionDot = billNeedsViewerAttention({
                      bill,
                      votes,
                      userId,
                      roleKeys,
                      userChambers,
                      isRunningMate,
                      canBreakSenateTie,
                    });
                    const viewerWhipInstruction = viewerWhipByBillId.get(bill.id) ?? null;
                    return (
                      <BillCard
                        key={bill.id}
                        bill={bill}
                        votes={votes}
                        voterById={voterById}
                        userId={userId}
                        roleKeys={roleKeys}
                        viewerParty={viewerParty}
                        viewerWhipInstruction={viewerWhipInstruction}
                        userChambers={userChambers}
                        isPresidentialRunningMate={isRunningMate}
                        canBreakSenateTie={canBreakSenateTie}
                        suppressVoteForms={suppressVoteForms}
                        showAttentionDot={showAttentionDot}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </div>
    </section>
  );
}
