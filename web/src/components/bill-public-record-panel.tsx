import Link from "next/link";
import { COMPANY_BILL_POSITIONS } from "@/lib/legislation-stock";

export type BillVoteHistoryRow = {
  id: string;
  vote: string;
  chamber: string;
  created_at: string;
  voter_name: string;
  voter_id: string;
};

export type BillCompanyPositionRow = {
  id: string;
  position: string;
  created_at: string;
  company_name: string;
  ticker_symbol: string | null;
  company_id: string;
};

export function BillPublicRecordPanel({
  votes,
  companyPositions,
}: {
  votes: BillVoteHistoryRow[];
  companyPositions: BillCompanyPositionRow[];
}) {
  const positionLabel = Object.fromEntries(COMPANY_BILL_POSITIONS.map((p) => [p.key, p.label]));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
        <h3 className="text-sm font-semibold">Public vote record</h3>
        {votes.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--psc-muted)]">No votes cast yet.</p>
        ) : (
          <ul className="mt-2 max-h-80 overflow-y-auto divide-y divide-[var(--psc-border)] text-sm">
            {votes.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0">
                <Link href={`/economy/disclosures/${v.voter_id}`} className="font-medium hover:underline">
                  {v.voter_name}
                </Link>
                <span className="text-xs text-[var(--psc-muted)]">
                  <span className="font-semibold uppercase text-[var(--psc-ink)]">{v.vote}</span> · {v.chamber} ·{" "}
                  {new Date(v.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
        <h3 className="text-sm font-semibold">Company positions</h3>
        {companyPositions.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--psc-muted)]">No companies have disclosed a position yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--psc-border)] text-sm">
            {companyPositions.map((p) => (
              <li key={p.id} className="py-2 first:pt-0">
                <p className="font-medium">
                  {p.ticker_symbol ? (
                    <Link href={`/economy/stocks/${p.ticker_symbol}`} className="hover:underline">
                      {p.company_name} ({p.ticker_symbol})
                    </Link>
                  ) : (
                    p.company_name
                  )}
                </p>
                <p className="text-xs text-[var(--psc-muted)]">
                  {positionLabel[p.position] ?? p.position} this bill · {new Date(p.created_at).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
