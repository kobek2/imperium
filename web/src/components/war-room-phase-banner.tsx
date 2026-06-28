"use client";

import { formatPhaseCountdown, type CampaignDayCycle } from "@/lib/campaign-day-cycle";

export function WarRoomPhaseBanner({
  cycle,
  rivalLabel,
  rivalEnabled,
}: {
  cycle: CampaignDayCycle;
  rivalLabel: string;
  rivalEnabled: boolean;
}) {
  const countdown = formatPhaseCountdown(cycle.phaseEndsAt);
  const isElections = cycle.phase === "elections";

  return (
    <section
      className={`rounded-lg border p-4 ${
        isElections
          ? "border-blue-300/60 bg-gradient-to-r from-blue-950/10 to-[var(--psc-panel)]"
          : "border-amber-300/60 bg-gradient-to-r from-amber-950/10 to-[var(--psc-panel)]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
            Daily war room cycle · CST
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--psc-ink)]">
            {isElections ? "Election cycle" : "Congress cycle"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--psc-muted)]">{cycle.phaseDescription}</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold tabular-nums text-[var(--psc-ink)]">{countdown}</p>
          <p className="text-xs text-[var(--psc-muted)]">{cycle.phaseLabel}</p>
          {rivalEnabled ? (
            <p className="mt-1 text-xs text-[var(--psc-muted)]">
              {isElections
                ? `${rivalLabel} is watching your PAC filings and counter-spending.`
                : `${rivalLabel} is filing legislation and whipping the GOP caucus.`}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
