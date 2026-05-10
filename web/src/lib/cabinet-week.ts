/** ISO date (YYYY-MM-DD) for the current UTC calendar day (cabinet engagement resets daily). */
export function cabinetDayStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
}

/** @deprecated Use {@link cabinetDayStartIso}; kept for older call sites. */
export function cabinetWeekStartIso(): string {
  return cabinetDayStartIso();
}
