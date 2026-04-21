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

/**
 * Whether this user may introduce bills that originate in the given chamber.
 * - House: Representatives, President, and site admins.
 * - Senate: Senators and site admins.
 * Holding both seats allows filing in both chambers.
 */
export function canFileLegislationInChamber(roleKeys: string[], chamber: BillChamber): boolean {
  if (!canFileFederalLegislation(roleKeys)) return false;
  const s = new Set(roleKeys);
  if (chamber === "house") {
    return s.has("admin") || s.has("president") || s.has("representative");
  }
  if (chamber === "senate") {
    return s.has("admin") || s.has("senator");
  }
  return false;
}
