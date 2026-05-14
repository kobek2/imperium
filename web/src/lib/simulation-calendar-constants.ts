/** Fixed simulation pace: 1.5 real weeks = 4 RP years (non-configurable). */
export const RP_MONTHS_PER_REAL_DAY = 48 / 10.5;

export const RP_START_YEAR = 2032;
export const RP_START_MONTH = 1;

const MS_PER_DAY = 86_400_000;

/**
 * RP month/year from simulation start (always January {@link RP_START_YEAR} at `simulationStartAt`).
 */
export function computeRpDate(simulationStartAt: Date, now: Date = new Date()): { year: number; month: number } {
  const elapsedDays = (now.getTime() - simulationStartAt.getTime()) / MS_PER_DAY;
  const elapsedRpMonths = elapsedDays * RP_MONTHS_PER_REAL_DAY;
  const totalMonths = (RP_START_YEAR - 1) * 12 + (RP_START_MONTH - 1) + elapsedRpMonths;
  const year = Math.floor(totalMonths / 12) + 1;
  const month = Math.floor(totalMonths % 12) + 1;
  return { year, month };
}

/**
 * Same as {@link computeRpDate} unless a calendar seat-cycle freeze is active (November of the
 * election year until midterm/presidential seating clears it).
 */
export function computeRpDateForCalendarTick(
  simulationStartAt: Date,
  now: Date,
  freezeYear?: number | null,
  freezeMonth?: number | null,
): { year: number; month: number } {
  if (
    freezeYear != null &&
    freezeMonth != null &&
    Number.isFinite(freezeYear) &&
    Number.isFinite(freezeMonth) &&
    freezeMonth >= 1 &&
    freezeMonth <= 12
  ) {
    return { year: Math.trunc(freezeYear), month: Math.trunc(freezeMonth) };
  }
  return computeRpDate(simulationStartAt, now);
}

export function rpDateKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Value to store in `simulation_settings.simulation_start_at` so that, at wall-clock `anchor`,
 * {@link computeRpDate} reports `year` / `month` (RP calendar).
 *
 * Used after major election seating so RP “ticks” to January of the new Congress / inauguration
 * while keeping the global RP pace ({@link RP_MONTHS_PER_REAL_DAY}) unchanged going forward.
 */
export function isoSimulationStartForRpInstantAt(anchor: Date, year: number, month: number): string {
  const targetTotalMonths = (year - 1) * 12 + (month - 1);
  const baseTotalMonths = (RP_START_YEAR - 1) * 12 + (RP_START_MONTH - 1);
  const deltaMonths = targetTotalMonths - baseTotalMonths;
  const elapsedDays = deltaMonths / RP_MONTHS_PER_REAL_DAY;
  return new Date(anchor.getTime() - elapsedDays * MS_PER_DAY).toISOString();
}
