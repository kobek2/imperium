/**
 * Seat elections can be created as dormant templates: `filing_window_started_at` is null
 * while `phase` is still `filing`. They are hidden from public listings until an admin opens filings.
 */
export function isDormantSeatFilingElection(row: {
  phase: string;
  leadership_role?: string | null;
  filing_window_started_at?: string | null;
}): boolean {
  if (row.phase !== "filing") return false;
  if (row.leadership_role) return false;
  return row.filing_window_started_at == null;
}

export function filingWindowIsOpen(row: {
  phase: string;
  filing_window_started_at?: string | null;
}): boolean {
  if (row.phase !== "filing") return true;
  return row.filing_window_started_at != null;
}
