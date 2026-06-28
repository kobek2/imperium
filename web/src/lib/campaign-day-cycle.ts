/** Campaign Manager daily rhythm — America/Chicago (CST/CDT). */

export type CampaignDayPhase = "elections" | "congress";

export type CampaignDayCycle = {
  phase: CampaignDayPhase;
  /** Hour in CST (0–23). */
  cstHour: number;
  /** ISO timestamp when the current 12h block ends. */
  phaseEndsAt: string;
  /** Human label for the active block. */
  phaseLabel: string;
  /** What unlocks in this block. */
  phaseDescription: string;
};

const TZ = "America/Chicago";

function cstParts(now = new Date()): { year: number; month: number; day: number; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
  };
}

function nextBoundaryUtc(now: Date, phase: CampaignDayPhase): Date {
  const { hour } = cstParts(now);
  if (phase === "elections" && hour < 12) {
    return new Date(
      now.getTime() + (12 - hour) * 3_600_000 - (now.getMinutes() * 60_000 + now.getSeconds() * 1000),
    );
  }
  const hoursUntilMidnight = 24 - hour;
  return new Date(
    now.getTime() + hoursUntilMidnight * 3_600_000 - (now.getMinutes() * 60_000 + now.getSeconds() * 1000),
  );
}

export function getCampaignDayCycle(now = new Date()): CampaignDayCycle {
  const { hour } = cstParts(now);
  const phase: CampaignDayPhase = hour < 12 ? "elections" : "congress";
  const phaseEndsAt = nextBoundaryUtc(now, phase).toISOString();

  if (phase === "elections") {
    return {
      phase,
      cstHour: hour,
      phaseEndsAt,
      phaseLabel: "Election cycle · 12:00 AM – 11:59 AM CST",
      phaseDescription: "PAC spending, rallies, and slate management. The rival watches your filings and counters.",
    };
  }
  return {
    phase,
    cstHour: hour,
    phaseEndsAt,
    phaseLabel: "Congress cycle · 12:00 PM – 11:59 PM CST",
    phaseDescription: "Draft legislation, whip your caucus, and track GOP bills moving through the hopper.",
  };
}

export function formatPhaseCountdown(phaseEndsAt: string, now = new Date()): string {
  const ms = new Date(phaseEndsAt).getTime() - now.getTime();
  if (ms <= 0) return "Switching…";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

export function isElectionActionsAllowed(cycle: CampaignDayCycle): boolean {
  return cycle.phase === "elections";
}

export function isCongressActionsAllowed(cycle: CampaignDayCycle): boolean {
  return cycle.phase === "congress";
}
