"use client";

import { formatFiscalMillions } from "@/lib/city-fiscal-data";
import type { CityFiscalSnapshot } from "@/lib/city-fiscal-data";

export function CityHealthStrip({
  fiscal,
  projectedTreasuryMillions,
}: {
  fiscal: CityFiscalSnapshot;
  /** Live draft preview: treasury after current budget surplus/deficit. */
  projectedTreasuryMillions?: number;
}) {
  const showProjection =
    projectedTreasuryMillions != null &&
    Math.abs(projectedTreasuryMillions - fiscal.treasuryBalance) > 0.000_001;

  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--psc-ink)]">City treasury</h2>
        <p className="text-sm tabular-nums text-[var(--psc-ink)]">
          {formatFiscalMillions(fiscal.treasuryBalance)}
          {showProjection ? (
            <>
              {" "}
              <span className="text-[var(--psc-muted)]">→</span>{" "}
              <span
                className={
                  projectedTreasuryMillions < fiscal.treasuryBalance
                    ? "text-red-800"
                    : projectedTreasuryMillions > fiscal.treasuryBalance
                      ? "text-green-800"
                      : ""
                }
              >
                {formatFiscalMillions(projectedTreasuryMillions)}
              </span>
              <span className="text-xs text-[var(--psc-muted)]"> if this budget enacts</span>
            </>
          ) : null}
        </p>
      </div>
    </section>
  );
}
