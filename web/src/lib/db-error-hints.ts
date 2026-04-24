/** True when a PostgREST error message suggests missing columns (for schema-compat retries). */
export function dbErrorHintsMissingColumn(message: string | undefined, needles: string[]) {
  const m = (message ?? "").toLowerCase();
  return needles.some((n) => m.includes(n));
}
