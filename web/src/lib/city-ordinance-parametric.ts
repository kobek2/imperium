export type ParametricCoalitionKey = "progressive" | "moderate" | "conservative";

/** Shared caucus lane from continuous economic score (property tax + parametric bills). */
export function deriveParametricCoalitionKey(
  issueEconomicScore: number,
): ParametricCoalitionKey | null {
  if (issueEconomicScore <= -15) return "progressive";
  if (issueEconomicScore >= 20) return "conservative";
  if (Math.abs(issueEconomicScore) <= 15) return "moderate";
  return null;
}
