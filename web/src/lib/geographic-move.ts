import { CABINET_APPOINTMENT_ROLE_KEYS } from "@/config/cabinet-appointment-roles";

/**
 * Roles whose holders are not subject to geographic relocation penalties
 * (must stay aligned with `apply_profile_geographic_move` in Supabase).
 */
export const GEOGRAPHIC_MOVE_EXEMPT_ROLE_KEYS = new Set<string>([
  "president",
  "vice_president",
  "cabinet",
  "chief_justice",
  "associate_justice",
  ...CABINET_APPOINTMENT_ROLE_KEYS,
]);

export function isGeographicMoveExempt(roleKeys: readonly string[]): boolean {
  return roleKeys.some((k) => GEOGRAPHIC_MOVE_EXEMPT_ROLE_KEYS.has(k));
}

export function normalizeStateCode(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function normalizeDistrictCode(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

/** True when home state or congressional district changes (after normalization). */
export function hasGeographicHomeChange(opts: {
  prevResidenceState: string | null | undefined;
  prevHomeDistrict: string | null | undefined;
  nextResidenceState: string | null | undefined;
  nextHomeDistrict: string | null | undefined;
}): boolean {
  const os = normalizeStateCode(opts.prevResidenceState);
  const ns = normalizeStateCode(opts.nextResidenceState);
  const od = normalizeDistrictCode(opts.prevHomeDistrict);
  const nd = normalizeDistrictCode(opts.nextHomeDistrict);
  return os !== ns || od !== nd;
}
