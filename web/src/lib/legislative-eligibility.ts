import type { BillChamber } from "@/lib/bill-types";

export function canFileCityLegislation(roleKeys: string[]): boolean {
  const s = new Set(roleKeys);
  return s.has("council_member") || s.has("council_spokesperson") || s.has("mayor") || s.has("admin");
}

/** @deprecated Federal sim */
export function canFileFederalLegislation(roleKeys: string[]): boolean {
  const s = new Set(roleKeys);
  return (
    s.has("representative") ||
    s.has("senator") ||
    s.has("president") ||
    s.has("admin") ||
    canFileCityLegislation(roleKeys)
  );
}

/**
 * Whether this user may introduce bills/ordinances that originate in the given chamber.
 * Millbrook: council members, spokesperson, mayor, admin.
 */
export function canFileLegislationInChamber(roleKeys: string[], chamber: BillChamber): boolean {
  if (!canFileFederalLegislation(roleKeys)) return false;
  const s = new Set(roleKeys);
  if (s.has("admin")) return true;
  if (chamber === "house") {
    return (
      s.has("council_member") ||
      s.has("council_spokesperson") ||
      s.has("mayor") ||
      s.has("president") ||
      s.has("representative")
    );
  }
  if (chamber === "senate") {
    return s.has("senator");
  }
  return false;
}

export function canRunForCouncilSpokesperson(roleKeys: string[]): boolean {
  return roleKeys.includes("council_member") || roleKeys.includes("admin");
}

export function canAppointDepartmentHeads(roleKeys: string[]): boolean {
  return roleKeys.includes("mayor") || roleKeys.includes("admin");
}
