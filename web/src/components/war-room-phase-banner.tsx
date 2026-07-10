"use client";

import type { CampaignTurnCycle } from "@/lib/campaign-day-cycle";
import { CAMPAIGN_COUNCIL_TURNS, formatTurnPosition } from "@/lib/campaign-day-cycle";

export function WarRoomPhaseBanner({
  cycle,
  rivalLabel,
  rivalEnabled,
  onEndTurn,
  endTurnPending,
  canEndTurn,
}: {
  cycle: CampaignTurnCycle;
  rivalLabel: string;
  rivalEnabled: boolean;
  onEndTurn?: () => void;
  endTurnPending?: boolean;
  canEndTurn?: boolean;
}) {
  const isElections = cycle.phase === "elections";

  return (
    <section
      className={`rounded-lg border p-4 ${
        isElections
          ? "border-blue-300/60 bg-gradient-to-r from-blue-950/5 to-[var(--psc-panel)]"
          : "border-amber-300/60 bg-gradient-to-r from-amber-950/5 to-[var(--psc-panel)]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
            Season turn track
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--psc-ink)]">
            {isElections ? "Election phase" : "Council session"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--psc-muted)]">{cycle.phaseDescription}</p>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
              <span>{formatTurnPosition(cycle)}</span>
              <span>{cycle.phaseLabel}</span>
            </div>
            <ol className="flex gap-0.5" aria-label="Turn track">
              {Array.from({ length: cycle.cycleTurns }, (_, i) => {
                const n = i + 1;
                const isCouncil = n <= CAMPAIGN_COUNCIL_TURNS;
                const isCurrent = n === cycle.turn;
                const isPast = n < cycle.turn;
                return (
                  <li
                    key={n}
                    title={`Turn ${n}: ${isCouncil ? "Council session" : "Elections"}`}
                    className={`h-2 min-w-0 flex-1 rounded-sm ${
                      isCurrent
                        ? isCouncil
                          ? "bg-[var(--psc-seal)] ring-1 ring-[var(--psc-seal)]"
                          : "bg-blue-600 ring-1 ring-blue-600"
                        : isPast
                          ? isCouncil
                            ? "bg-amber-400/70"
                            : "bg-blue-400/70"
                          : isCouncil
                            ? "bg-amber-200/80"
                            : "bg-blue-100"
                    }`}
                  />
                );
              })}
            </ol>
            <div className="mt-1 flex justify-between text-[9px] text-[var(--psc-muted)]">
              <span>Council ×{CAMPAIGN_COUNCIL_TURNS}</span>
              <span>Elections ×{cycle.cycleTurns - CAMPAIGN_COUNCIL_TURNS}</span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2 text-right text-sm">
          <p className="font-semibold tabular-nums text-[var(--psc-ink)]">
            Turn {cycle.turnInPhase} / {cycle.turnsInPhase}
          </p>
          <p className="text-xs text-[var(--psc-muted)]">
            {isElections ? "PAC & races live" : "Finish legislative round → turn auto-advances"}
          </p>
          {canEndTurn && onEndTurn && isElections ? (
            <button
              type="button"
              disabled={endTurnPending}
              onClick={onEndTurn}
              className="mt-1 rounded bg-[var(--psc-seal)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {endTurnPending ? "Advancing…" : "End turn →"}
            </button>
          ) : null}
          {rivalEnabled ? (
            <p className="max-w-[14rem] text-xs text-[var(--psc-muted)]">
              {isElections
                ? `${rivalLabel} counter-spends when you advance or file PAC money.`
                : `${rivalLabel} whips and proposes when you advance turns.`}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
