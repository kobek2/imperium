const MS_PER_DAY = 86_400_000;
/** Mean Gregorian month length (365.2425 / 12). */
const MEAN_MONTH_DAYS = 30.436875;

export type SimulationSettingsRow = {
  id: number;
  real_anchor_at: string;
  rp_anchor_date: string;
  rp_months_per_real_day: number;
  admin_rp_month_offset: number;
  auto_open_filings_in_rp_january: boolean;
  last_auto_open_rp_key: string | null;
};

function parseISODateOnly(s: string): { y: number; m: number; d: number } {
  const parts = s.trim().split("-").map((x) => Number(x));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2] ?? 1;
  if (!Number.isFinite(y) || !Number.isFinite(m)) return { y: 2023, m: 1, d: 1 };
  return { y, m, d: Number.isFinite(d) ? d : 1 };
}

/** Add whole calendar months in UTC (Date normalizes day-of-month). */
function addWholeMonthsUTC(base: Date, wholeMonths: number): Date {
  const d = new Date(base.getTime());
  d.setUTCMonth(d.getUTCMonth() + wholeMonths);
  return d;
}

export type SimulationRpInstant = {
  /** Instant used for labels and month checks. */
  at: Date;
  /** RP calendar year (UTC). */
  year: number;
  /** 1–12 (UTC). */
  month: number;
  /** YYYY-MM in RP calendar (UTC), for dedupe keys. */
  yearMonthKey: string;
  /** e.g. "April 2026" */
  label: string;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_NAMES_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Compact “Apr 2026” for status corners and small UI. */
export function formatRpCalendarShort(instant: SimulationRpInstant): string {
  const mon = MONTH_NAMES_SHORT[instant.month - 1] ?? "???";
  return `${mon} ${instant.year}`;
}

/**
 * Computes the current simulation calendar instant from real time.
 * Pace: `rp_months_per_real_day` RP months per real Earth day (fixed; default 3.5).
 * `admin_rp_month_offset` shifts the timeline in whole or fractional RP months.
 */
export function computeSimulationRpInstant(
  settings: SimulationSettingsRow,
  now: Date = new Date(),
): SimulationRpInstant {
  const anchor = parseISODateOnly(settings.rp_anchor_date);
  const baseUtc = new Date(
    Date.UTC(anchor.y, anchor.m - 1, anchor.d, 12, 0, 0),
  );
  const anchorRealMs = new Date(settings.real_anchor_at).getTime();
  const elapsedDays = (now.getTime() - anchorRealMs) / MS_PER_DAY;
  const pace = Number(settings.rp_months_per_real_day) || 3.5;
  const offset = Number(settings.admin_rp_month_offset) || 0;
  const floatMonths = offset + elapsedDays * pace;

  const whole = Math.trunc(floatMonths);
  const frac = floatMonths - whole;

  const afterWhole = addWholeMonthsUTC(baseUtc, whole);
  const at = new Date(afterWhole.getTime() + frac * MEAN_MONTH_DAYS * MS_PER_DAY);

  const year = at.getUTCFullYear();
  const month = at.getUTCMonth() + 1;
  const yearMonthKey = `${year}-${String(month).padStart(2, "0")}`;
  const label = `${MONTH_NAMES[month - 1] ?? "Month"} ${year}`;

  return { at, year, month, yearMonthKey, label };
}

/** Start of the given instant’s UTC calendar day. */
export function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/**
 * If `real_anchor_at` was left far in the past while pace is high, the computed calendar can jump
 * decades ahead (e.g. 2050s) even though `rp_anchor_date` is ~2023. That usually means the real
 * anchor was never aligned after changing the RP anchor.
 *
 * Returns settings adjusted for **display**: `real_anchor_at` is moved to the start of the
 * current UTC day so the clock advances normally from the RP anchor without sci-fi years.
 * Callers with admin + Supabase should persist when `shouldPersistHealToDatabase` is true.
 */
export function healSimulationClockDrift(
  raw: SimulationSettingsRow,
  now: Date = new Date(),
): { displaySettings: SimulationSettingsRow; shouldPersistHealToDatabase: boolean } {
  const probe = computeSimulationRpInstant(raw, now);
  const anchorY = parseISODateOnly(raw.rp_anchor_date).y;
  const stalenessDays = (now.getTime() - new Date(raw.real_anchor_at).getTime()) / MS_PER_DAY;

  // If the real anchor was left behind while pace is high, the calendar can jump many years
  // ahead of `rp_anchor_date`. Heal when that gap is clearly unintended (tunable thresholds).
  if (!(stalenessDays > 2 && probe.year > anchorY + 6)) {
    return { displaySettings: raw, shouldPersistHealToDatabase: false };
  }

  const displaySettings = { ...raw, real_anchor_at: utcDayStart(now).toISOString() };
  return { displaySettings, shouldPersistHealToDatabase: true };
}

export function defaultSimulationSettingsForDisplay(): SimulationSettingsRow {
  return {
    id: 1,
    real_anchor_at: new Date().toISOString(),
    rp_anchor_date: "2023-01-01",
    rp_months_per_real_day: 3.5,
    admin_rp_month_offset: 0,
    auto_open_filings_in_rp_january: false,
    last_auto_open_rp_key: null,
  };
}
