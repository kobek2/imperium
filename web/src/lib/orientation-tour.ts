export function orientationStepOrDefault(step: number | null | undefined): 1 | 2 | 3 {
  if (step === 2 || step === 3) return step;
  return 1;
}

/** Any race still in play — broader than dashboard "active" (includes dormant filing seats you can file in). */
export function nonClosedElectionIds(rows: Array<{ id: string; phase: string }>): string[] {
  return rows.filter((e) => e.phase !== "closed").map((e) => e.id);
}
