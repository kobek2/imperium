/**
 * -------------------------------------------------------------------------------------------------
 * U.S. federal election cadence vs. this simulation (single source of truth for calendar ticks)
 * -------------------------------------------------------------------------------------------------
 *
 * | Real world (U.S.)                         | In this simulation |
 * |-------------------------------------------|--------------------|
 * | **Jan 2029** — new president + Congress | RP **January 2029** (`inauguration_2029`). Current RP month/year comes from `simulation_start_at` + {@link RP_MONTHS_PER_REAL_DAY} in `simulation-calendar-constants.ts`. |
 * | **Nov 2030** — midterm general election | We do **not** give November its own RP month. The midterm **seat** cycle opens the first time RP reaches **January 2031** (the month the new Congress is sworn in). All filing / primary / general phases then run on **real wall-clock** timers (congressional races: 24h / 24h / 24h). |
 * | **Jan 2031** — new Congress begins      | After every House + Senate (class 2) race in `calendar_cycle_key = midterms_2030` is **closed**, `handleMidtermSeating` applies calendar seating and sets `simulation_start_at` so RP reads **January 2031** at that instant. |
 * | **Nov 2032** — presidential + Congress  | Same pattern: seat cycle opens first RP **January 2033** (inauguration month of the new term). `calendar_cycle_key = presidential_2032` (election **year**). Congressional races 24h/24h/24h; president 24h/24h/48h general. |
 * | **Jan 2033** — new president + Congress | `handlePresidentialCycleSeating` seats when all races in that cycle are **closed**, then snaps RP to **January 2033**. |
 *
 * **Seating rule:** A new Congress / new president is applied only after **every** seat race in that
 * `calendar_cycle_key` is `closed` (certified), then calendar seating + role transitions run.
 *
 * **Senate classes** in calendar inserts are a game template (class **2** at the first midterm cycle,
 * class **3** at the presidential cycle), not a full real-world state-by-state class map.
 * -------------------------------------------------------------------------------------------------
 */

/** RP year of the first inauguration milestone (`inauguration_${…}`). */
export const US_INAUGURAL_RP_YEAR = 2029 as const;

/** U.S. midterm **general election** year (November of this year in real life). */
export const US_MIDTERM_ELECTION_YEAR = 2030 as const;

/**
 * First RP calendar month when midterm seat races **open** (analogue: after November; new Congress year January).
 */
export const RP_YEAR_MONTH_OPEN_MIDTERM_SEAT_CYCLE = { year: 2031 as const, month: 1 as const };

/** U.S. presidential **general election** year (November of this year in real life). */
export const US_PRESIDENTIAL_ELECTION_YEAR = 2032 as const;

/**
 * First RP calendar month when presidential-cycle seat races **open** (January of inauguration year).
 */
export const RP_YEAR_MONTH_OPEN_PRESIDENTIAL_SEAT_CYCLE = { year: 2033 as const, month: 1 as const };

/** True once RP has reached the given calendar month (year + month). */
export function rpAtOrPastMonth(
  rp: { year: number; month: number },
  target: { year: number; month: number },
): boolean {
  if (rp.year > target.year) return true;
  if (rp.year < target.year) return false;
  return rp.month >= target.month;
}
