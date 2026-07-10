import {
  cyclePhaseLabel,
  formatCitySimWeek,
  phaseChangeBannerMessage,
  turnPhaseLabel,
  type CitySimWeekStatus,
} from "@/lib/city-sim-week";

function formatPhaseEnds(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function CitySimWeekBanner({ status }: { status: CitySimWeekStatus }) {
  const phaseAlert = phaseChangeBannerMessage(status);
  const ends = formatPhaseEnds(status.phaseEndsAt);

  return (
    <div className="space-y-2">
      {phaseAlert ? (
        <div className="rounded border border-violet-400/60 bg-violet-50 px-3 py-2 text-xs text-violet-950">
          {phaseAlert}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2 text-xs">
        <div>
          <p className="font-semibold text-[var(--psc-ink)]">
            {formatCitySimWeek(status)} · Biennium {status.bienniumIndex}
          </p>
          <p className="text-[var(--psc-muted)]">
            {cyclePhaseLabel(status.cyclePhase)}
            {ends ? ` · next phase ~${ends}` : ""}
            {" · "}
            Class {status.activeCouncilClass}
            {status.mayorElectionActive ? " · Mayor race year" : ""}
          </p>
        </div>
        <p className="text-[var(--psc-muted)]">
          {status.budgetProposalOpen && !status.budgetEnacted
            ? status.cyclePhase === "legislative"
              ? "Legislative session — submit and pass the biennium budget first."
              : "Budget proposal window open."
            : status.budgetPassed
              ? status.ordinancesAllowed
                ? "Legislative session — ordinances open."
                : "Awaiting legislative window."
              : status.budgetEnacted
                ? status.ordinancesAllowed
                  ? "Legislative session — ordinances open."
                  : "Awaiting legislative window."
                : "Pass the biennium budget to unlock legislation."}
          {status.campaignActive ? (
            <>
              {" "}
              · {turnPhaseLabel(status.turnPhase)} · campaign turn {status.campaignTurn}
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
