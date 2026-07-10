export function orientationStepOrDefault(step: number | null | undefined): 1 | 2 | 3 {
  if (step === 2 || step === 3) return step;
  return 1;
}

/** Any mayor/council race still in play (excludes chamber leadership — those live under legacy admin). */
export function nonClosedElectionIds(
  rows: Array<{ id: string; phase: string; leadership_role?: string | null }>,
): string[] {
  return rows
    .filter((e) => e.phase !== "closed" && !e.leadership_role)
    .map((e) => e.id);
}
