/**
 * Cabinet “priority belt” — seven pacing theaters (State + Defense + NSC).
 * Order is deliberate (Indo-Pacific → Europe → MENA → allies); not alphabetical.
 */
export const DEFENSE_OPS_WATCHLIST_ORDER = [
  "CHN",
  "RUS",
  "IRN",
  "TWN",
  "UKR",
  "KOR",
  "ISR",
] as const;

export type DefenseOpsWatchlistCode = (typeof DEFENSE_OPS_WATCHLIST_ORDER)[number];

const WATCH = new Set<string>(DEFENSE_OPS_WATCHLIST_ORDER);

/** Nations on the SecDef watchlist that exist in the current DB row set, in display order. */
export function selectDefenseWatchlistNations<T extends { code: string }>(nations: T[]): T[] {
  const byCode = new Map(nations.map((n) => [n.code, n]));
  const out: T[] = [];
  for (const code of DEFENSE_OPS_WATCHLIST_ORDER) {
    const row = byCode.get(code);
    if (row) out.push(row);
  }
  return out;
}

export function isDefenseWatchlistCode(code: string): boolean {
  return WATCH.has(code);
}

/** Posture rows for the SecDef belt, in pacing order (skips nations missing from `rows`). */
export function selectDefenseWatchlistPosture<T extends { nation_code: string }>(rows: T[]): T[] {
  const byCode = new Map(rows.map((r) => [String(r.nation_code), r]));
  const out: T[] = [];
  for (const code of DEFENSE_OPS_WATCHLIST_ORDER) {
    const row = byCode.get(code);
    if (row) out.push(row);
  }
  return out;
}
