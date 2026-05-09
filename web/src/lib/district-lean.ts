/**
 * Cook-style PVI convention used in the districts table:
 *   positive PVI → favors Democrats
 *   negative PVI → favors Republicans
 *   zero         → even
 *
 * Returns a short, plain-language lean label (e.g. "+5 Republican", "+3 Democratic", "Even").
 */
export function formatDistrictLean(pvi: number | null | undefined): string {
  const n = Number(pvi ?? 0);
  if (!Number.isFinite(n) || n === 0) return "Even";
  const magnitude = Math.abs(Math.trunc(n));
  const party = n > 0 ? "Democratic" : "Republican";
  return `+${magnitude} ${party}`;
}
