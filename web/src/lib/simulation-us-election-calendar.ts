/**
 * -------------------------------------------------------------------------------------------------
 * U.S. federal election cadence vs. this simulation (single source of truth for calendar ticks)
 * -------------------------------------------------------------------------------------------------
 *
 * | Real world (U.S.)                         | In this simulation |
 * |-------------------------------------------|--------------------|
 * | **Jan 2032** — new president + Congress | RP **January 2032** (`inauguration_2032`). Current RP month/year comes from `simulation_start_at` + {@link RP_MONTHS_PER_REAL_DAY} in `simulation-calendar-constants.ts`. |
 * | **Nov (election year)** — general election month | Midterm years **2034, 2038, …** and presidential years **2036, 2040, …** (through {@link CALENDAR_US_FEDERAL_SEAT_CYCLE_MAX_ELECTION_YEAR}): seat races open the first time RP reaches **November** of that year. RP is then **frozen** at that November until every race in the cycle is **closed** (72h wall-clock phases: 24h filing / 24h primary / 24h general). |
 * | **Jan (election year + 1)** — new Congress / president | After seating, `simulation_start_at` is set so RP reads **January** of the year after the election (e.g. 2036 election → Jan **2037**; 2038 midterm → Jan **2039**), and the freeze clears. Chamber + party leadership windows use {@link CALENDAR_LEADERSHIP_WINDOW_HOURS}h wall clock. |
 *
 * **Seating rule:** A new Congress / new president is applied only after **every** seat race in that
 * `calendar_cycle_key` is `closed` (certified), then calendar seating + role transitions run.
 *
 * **Senate classes** in calendar inserts are a game template (class **2** at the first midterm cycle,
 * class **3** at the presidential cycle), not a full real-world state-by-state class map.
 * -------------------------------------------------------------------------------------------------
 */

/** RP year of the first inauguration milestone (`inauguration_${…}`). */
export const US_INAUGURAL_RP_YEAR = 2032 as const;

/** U.S. midterm **general election** year (November of this year in real life). */
export const US_MIDTERM_ELECTION_YEAR = 2034 as const;

/** U.S. presidential **general election** year (November of this year in real life). */
export const US_PRESIDENTIAL_ELECTION_YEAR = 2036 as const;

/** Last U.S. election year the automated calendar will open seat cycles for (inclusive). */
export const CALENDAR_US_FEDERAL_SEAT_CYCLE_MAX_ELECTION_YEAR = 2050 as const;

/**
 * Wall-clock hours after seating/inauguration milestones for:
 * - deferred `leadership_close_*` calendar events (see `calendar-event-engine.ts`),
 * - chamber `leadership_sessions.closes_at` (via `leadershipRaceScheduleFromNow`),
 * - D/R party officer filing windows (`calendar_open_party_leadership_windows`).
 */
export const CALENDAR_LEADERSHIP_WINDOW_HOURS = 12 as const;

/** True once RP has reached the given calendar month (year + month). */
export function rpAtOrPastMonth(
  rp: { year: number; month: number },
  target: { year: number; month: number },
): boolean {
  if (rp.year > target.year) return true;
  if (rp.year < target.year) return false;
  return rp.month >= target.month;
}
