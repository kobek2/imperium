import type { BillChamber } from "@/lib/bill-types";

export function canFileFederalLegislation(roleKeys: string[]): boolean {
  const s = new Set(roleKeys);
  return (
    s.has("representative") ||
    s.has("senator") ||
    s.has("president") ||
    s.has("admin")
  );
}

/** Chamber where this member may introduce bills (seat-derived). */
export function originatingChamberForRoles(roleKeys: string[]): BillChamber | null {
  const s = new Set(roleKeys);
  if (s.has("admin")) return "house";
  if (s.has("president")) return "house";
  if (s.has("senator")) return "senate";
  if (s.has("representative")) return "house";
  return null;
}
