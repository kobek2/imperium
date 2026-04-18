export type PartisanTag = "democrat" | "republican" | "independent";

/** Normalize UI / legacy strings so lean math and tiebreaks stay consistent. */
export function normalizePartisanParty(party: string | null | undefined): PartisanTag | null {
  const x = String(party ?? "")
    .trim()
    .toLowerCase();
  if (x === "democrat" || x === "democratic") return "democrat";
  if (x === "republican" || x === "gop") return "republican";
  if (x === "independent") return "independent";
  return null;
}

/**
 * Tiebreak priority from how well a candidate's party lines up with the jurisdiction's
 * stored partisan lean (`pvi` / `partisan_lean`): Harris two-party margin in percentage
 * points (positive = Democratic lean, negative = Republican lean), matching
 * `districtLeanBonus` / campaign-point lean.
 *
 * Used only when blended scores are identical: higher value wins. Independents get 0.
 */
export function leanTiePriority(party: string, signedMargin: number): number {
  const lean = Number(signedMargin) || 0;
  const p = normalizePartisanParty(party);
  if (p === "democrat") return lean;
  if (p === "republican") return -lean;
  return 0;
}
