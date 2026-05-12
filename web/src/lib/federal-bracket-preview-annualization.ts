/**
 * Federal budget “bracket impact” preview: turn scheduled **per sim hour** gross (role + PAC) into a
 * simple **estimated calendar-year** salary inflow so marginal bands line up with FY appropriations planning.
 *
 * Matches `economy_collect_income`: each collect pays at most this many sim-hours of scheduled gross.
 */
export const ECONOMY_MAX_SIM_HOURS_PAID_PER_COLLECT = 24;

/**
 * Planning assumption: one collect per real calendar day for a full year (President-facing headline only).
 */
export const FEDERAL_BRACKET_PREVIEW_COLLECTS_PER_IRL_YEAR = 365;

/** Product of the two constants above (8,760). */
export const FEDERAL_BRACKET_PREVIEW_ANNUALIZATION_MULTIPLIER =
  ECONOMY_MAX_SIM_HOURS_PAID_PER_COLLECT * FEDERAL_BRACKET_PREVIEW_COLLECTS_PER_IRL_YEAR;

export function annualizeScheduledHourlyGrossForFederalBracketPreview(hourlyScheduledGross: number): number {
  const h = Number(hourlyScheduledGross);
  if (!Number.isFinite(h) || h <= 0) return 0;
  return h * FEDERAL_BRACKET_PREVIEW_ANNUALIZATION_MULTIPLIER;
}
