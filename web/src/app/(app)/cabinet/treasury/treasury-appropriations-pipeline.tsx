import Link from "next/link";

export type AppropriationsBillRow = {
  id: string;
  title: string;
  status: string;
  signed_at: string | null;
};

export type TreasuryLineRow = {
  key: string;
  label: string;
  minimum: number;
  allocated: number;
};

function statusLabel(status: string): string {
  const s = status.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function TreasuryAppropriationsPipeline({
  fiscalYearLabel,
  budgetStatus,
  appropriationDeadlineAt,
  governmentShutdown,
  enrolledBillId,
  enrolledBillTitle,
  enrolledSignedAt,
  inCongressBills,
  federalTreasuryBalance,
  totalAssessedIncomeTaxLedger,
  lineRows,
  totalAllocated,
}: {
  fiscalYearLabel: string;
  budgetStatus: string | null;
  appropriationDeadlineAt: string | null;
  governmentShutdown: boolean;
  enrolledBillId: string | null;
  enrolledBillTitle: string | null;
  enrolledSignedAt: string | null;
  inCongressBills: AppropriationsBillRow[];
  federalTreasuryBalance: number;
  /** Sum of assessed federal income tax on `fiscal_tax_accounts` for the active FY (ledger total across players). */
  totalAssessedIncomeTaxLedger: number | null;
  lineRows: TreasuryLineRow[];
  totalAllocated: number;
}) {
  const deadlineLabel = appropriationDeadlineAt
    ? new Date(appropriationDeadlineAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  const gapVsTreasury = federalTreasuryBalance - totalAllocated;

  return (
    <section
      className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5"
      aria-labelledby="treasury-app-pipeline-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="treasury-app-pipeline-heading" className="text-lg font-semibold text-[var(--psc-ink)]">
            Appropriations and federal cash
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--psc-muted)]">
            The annual appropriations act is a normal bill linked to the active fiscal year. When it is signed into law, the sim
            stores the bill id on the fiscal year (clearing the shutdown clock) and raises each line&apos;s budget floor to at least
            the amount appropriated in that act. Treasury cash is not automatically moved to match those amounts; use
            Deploy treasury cash below to record cash against each line bucket or U.S. debt. The table below is the current budget row: floor vs enacted allocation, with
            totals compared to the federal treasury balance.
          </p>
        </div>
        <Link
          href="/economy/federal"
          className="shrink-0 rounded border border-[var(--psc-border)] px-3 py-1.5 text-xs font-semibold text-[var(--psc-accent)] hover:underline"
        >
          Federal budget workspace
        </Link>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded border border-[var(--psc-border)]/80 bg-[var(--psc-panel)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Sum of line allocations</p>
          <p className="mt-1 font-mono text-lg text-[var(--psc-ink)]">{fmtUsd(totalAllocated)}</p>
          <p className="mt-1 text-[11px] text-[var(--psc-muted)]">Total enacted in the budget JSON (what Congress is funding).</p>
        </div>
        <div className="rounded border border-[var(--psc-border)]/80 bg-[var(--psc-panel)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Federal treasury (cash)</p>
          <p className="mt-1 font-mono text-lg text-[var(--psc-ink)]">{fmtUsd(federalTreasuryBalance)}</p>
          <p className="mt-1 text-[11px] text-[var(--psc-muted)]">
            {gapVsTreasury >= 0
              ? `Treasury is ${fmtUsd(gapVsTreasury)} ahead of summed allocations (headroom).`
              : `Treasury is ${fmtUsd(-gapVsTreasury)} short of summed allocations.`}
          </p>
        </div>
        <div className="rounded border border-[var(--psc-border)]/80 bg-[var(--psc-panel)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Assessed income tax (ledger total)
          </p>
          <p className="mt-1 font-mono text-lg text-[var(--psc-ink)]">
            {totalAssessedIncomeTaxLedger != null ? fmtUsd(totalAssessedIncomeTaxLedger) : "—"}
          </p>
          <p className="mt-1 text-[11px] text-[var(--psc-muted)]">
            Sum of <code>fiscal_tax_accounts.assessed_tax</code> for this fiscal year (everyone on the tax ledger). Each row
            uses the same RP-year bracket model as the federal workbook (marginal tax on one scheduled sim-hour of role +
            PAC gross, then <strong>×72</strong>), not wallet balances or voluntary overpayments.
          </p>
        </div>
      </div>

      {lineRows.length > 0 ? (
        <div className="mt-5 overflow-x-auto">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Line items (budget row)</p>
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--psc-border)]">
                <th className="py-2 pr-2">Department</th>
                <th className="py-2 pr-2">Floor (minimum)</th>
                <th className="py-2 pr-2">Allocated</th>
                <th className="py-2">Headroom</th>
              </tr>
            </thead>
            <tbody>
              {lineRows.map((r) => {
                const headroom = r.allocated - r.minimum;
                return (
                  <tr key={r.key} className="border-b border-[var(--psc-border)]/60">
                    <td className="py-1.5 pr-2 text-[var(--psc-ink)]">{r.label || r.key}</td>
                    <td className="py-1.5 pr-2 font-mono">{fmtUsd(r.minimum)}</td>
                    <td className="py-1.5 pr-2 font-mono">{fmtUsd(r.allocated)}</td>
                    <td className="py-1.5 font-mono text-[var(--psc-muted)]">{fmtUsd(headroom)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-[var(--psc-muted)]">
            After each enrolled appropriations act, the floor is set to at least the allocated amount for that line, so headroom
            here is usually zero right after signing.
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--psc-muted)]">No line items on the federal budget row yet.</p>
      )}

      <ol className="mt-6 space-y-0 border-l border-[var(--psc-border)] pl-4">
        <li className="relative pb-6 pl-2 last:pb-0">
          <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-[var(--psc-accent)]" aria-hidden />
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">1. Federal budget row</p>
          <p className="mt-0.5 text-sm text-[var(--psc-ink)]">
            {fiscalYearLabel} · status <span className="font-mono">{budgetStatus ?? "unknown"}</span>
          </p>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Presidents and staff edit brackets and lines on the federal page; filing the appropriations bill copies that draft into
            Congress.
          </p>
        </li>

        <li className="relative pb-6 pl-2 last:pb-0">
          <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-[var(--psc-accent)]" aria-hidden />
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">2. Appropriations bill in Congress</p>
          {inCongressBills.length === 0 ? (
            <p className="mt-0.5 text-sm text-[var(--psc-muted)]">No open appropriations bill linked to this fiscal year.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {inCongressBills.map((b) => (
                <li key={b.id} className="text-sm">
                  <Link href={`/bill/${b.id}`} className="font-semibold text-[var(--psc-accent)] underline-offset-2 hover:underline">
                    {b.title.trim() || "Untitled"}
                  </Link>
                  <span className="ml-2 text-xs text-[var(--psc-muted)]">({statusLabel(b.status)})</span>
                </li>
              ))}
            </ul>
          )}
          {deadlineLabel ? (
            <p className="mt-2 text-xs text-[var(--psc-muted)]">
              Enrollment deadline (IRL): {deadlineLabel}
              {governmentShutdown ? (
                <span className="ml-1 font-semibold text-rose-800">· Shutdown: deadline passed with no enrolled act.</span>
              ) : null}
            </p>
          ) : null}
        </li>

        <li className="relative pb-6 pl-2 last:pb-0">
          <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-[var(--psc-accent)]" aria-hidden />
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">3. Enrolled appropriations act</p>
          {enrolledBillId ? (
            <div className="mt-1 text-sm">
              <Link
                href={`/bill/${enrolledBillId}`}
                className="font-semibold text-[var(--psc-accent)] underline-offset-2 hover:underline"
              >
                {enrolledBillTitle?.trim() ? enrolledBillTitle.trim() : "View enrolled act"}
              </Link>
              {enrolledSignedAt ? (
                <span className="ml-2 text-xs text-[var(--psc-muted)]">
                  Signed {new Date(enrolledSignedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </span>
              ) : null}
              <p className="mt-2 text-xs text-[var(--psc-muted)]">
                This fiscal year&apos;s enrolled act pointer is set; line floors were raised to at least the appropriated amounts
                when the President signed.
              </p>
            </div>
          ) : (
            <p className="mt-0.5 text-sm text-[var(--psc-muted)]">
              Awaiting a linked appropriations bill to reach law and presidential signature.
            </p>
          )}
        </li>

        <li className="relative pl-2 last:pb-0">
          <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-[var(--psc-accent)]" aria-hidden />
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">4. Execution</p>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--psc-muted)]">
            Year-end spending still reads the budget JSON for this fiscal year. Income tax collection and penalties are handled in
            the tax accounts section below.
          </p>
        </li>
      </ol>
    </section>
  );
}
