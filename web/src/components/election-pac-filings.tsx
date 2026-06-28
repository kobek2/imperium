import Link from "next/link";
import { profilePath } from "@/components/profile-card";
import type { ElectionPacFilingsBundle } from "@/lib/pac-filings";

function formatMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatFiledAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ElectionPacFilings({
  bundle,
  electionOffice,
  listKeyPrefix,
}: {
  bundle: ElectionPacFilingsBundle;
  electionOffice: string;
  listKeyPrefix: string;
}) {
  const isPresident = electionOffice === "president";
  const { filings, totalDisclosed, committeeCount, byCandidate } = bundle;

  if (filings.length === 0) {
    return (
      <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
              FEC disclosures
            </p>
            <h3 className="mt-1 text-sm font-semibold text-[var(--psc-ink)]">
              Independent expenditure filings
            </h3>
          </div>
        </header>
        <p className="mt-3 rounded-xl border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/40 px-4 py-3 text-sm text-[var(--psc-muted)]">
          No disclosed PAC contributions have been filed for this race yet.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
            FEC disclosures
          </p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--psc-ink)]">
            Independent expenditure filings
          </h3>
          <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
            Schedule E · disclosed PAC treasury spending · +1 campaign point per $250,000 (rounded down)
          </p>
        </div>
        <div className="text-right text-xs text-[var(--psc-muted)]">
          <p>
            <span className="font-semibold text-[var(--psc-ink)]">{formatMoney(totalDisclosed)}</span>{" "}
            total disclosed
          </p>
          <p>
            {committeeCount} committee{committeeCount === 1 ? "" : "ies"} · {filings.length} filing
            {filings.length === 1 ? "" : "s"}
          </p>
        </div>
      </header>

      {byCandidate.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {byCandidate.map((row) => (
            <div
              key={`${listKeyPrefix}-total-${row.candidateId}`}
              className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 px-3 py-2.5"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--psc-muted)]">
                Support for
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold text-[var(--psc-ink)]">
                {row.candidateName}
              </p>
              <p className="mt-1 font-mono text-sm tabular-nums text-[var(--psc-ink)]">
                {formatMoney(row.totalAmount)}
              </p>
              <p className="text-xs text-[var(--psc-muted)]">
                +{row.totalPoints} pts · {row.committeeCount} committee
                {row.committeeCount === 1 ? "" : "ies"}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--psc-border)]">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--psc-muted)]">
              <th className="px-3 py-2.5 font-semibold">Filed</th>
              <th className="px-3 py-2.5 font-semibold">Committee</th>
              <th className="px-3 py-2.5 font-semibold">Recipient</th>
              {isPresident ? <th className="px-3 py-2.5 font-semibold">State</th> : null}
              <th className="px-3 py-2.5 text-right font-semibold">Amount</th>
              <th className="px-3 py-2.5 text-right font-semibold">Points</th>
            </tr>
          </thead>
          <tbody>
            {filings.map((row) => (
              <tr
                key={`${listKeyPrefix}-${row.id}`}
                className="border-b border-[var(--psc-border)]/60 last:border-0"
              >
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[var(--psc-muted)]">
                  {formatFiledAt(row.disclosedAt)}
                </td>
                <td className="px-3 py-2.5">
                  {profilePath(row.pacUserId) ? (
                    <Link
                      href={profilePath(row.pacUserId)!}
                      className="font-medium text-[var(--psc-ink)] underline-offset-2 hover:underline"
                    >
                      {row.pacName}
                    </Link>
                  ) : (
                    <span className="font-medium text-[var(--psc-ink)]">{row.pacName}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 font-medium text-[var(--psc-ink)]">{row.candidateName}</td>
                {isPresident ? (
                  <td className="px-3 py-2.5 font-mono text-xs text-[var(--psc-muted)]">
                    {row.targetState ?? "—"}
                  </td>
                ) : null}
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatMoney(row.amount)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--psc-muted)]">
                  +{row.campaignPoints}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
