/**
 * @deprecated Legacy 3-region federal sim — New York City is the active geography.
 * Re-exports city helpers and keeps legacy codes for unmigrated rows.
 */

import {
  NYC_CITY_CODE,
  NYC_CITY_NAME,
  NYC_COUNCIL_DISTRICT_CODES,
  NYC_COUNCIL_DISTRICTS,
  MILLBROOK_CITY_CODE,
  MILLBROOK_CITY_NAME,
  MILLBROOK_WARD_CODES,
  MILLBROOK_WARDS,
  isNycCouncilDistrictCode,
  isMillbrookWardCode,
  normalizeResidenceCode,
  councilDistrictByCode,
  wardByCode,
  councilDistrictLabel,
  wardLabel,
  type NycCouncilDistrictCode,
  type MillbrookWardCode,
} from "@/lib/city";

export type UsRegion = "northeast_midwest" | "south" | "west";

/** @deprecated Use NYC_COUNCIL_DISTRICTS — kept for legacy imports. */
export const SIM_REGIONS = [
  { code: NYC_CITY_CODE, name: NYC_CITY_NAME, region: "northeast_midwest" as UsRegion, houseDistricts: 7 },
] as const;

export type SimRegionCode = typeof NYC_CITY_CODE | "NE" | "SO" | "WE";

export const SIM_REGION_CODES = [NYC_CITY_CODE, "NE", "SO", "WE"] as SimRegionCode[];

export {
  NYC_CITY_CODE,
  NYC_CITY_NAME,
  NYC_COUNCIL_DISTRICTS,
  NYC_COUNCIL_DISTRICT_CODES,
  isNycCouncilDistrictCode,
  councilDistrictByCode,
  councilDistrictLabel,
  MILLBROOK_CITY_CODE,
  MILLBROOK_CITY_NAME,
  MILLBROOK_WARDS,
  MILLBROOK_WARD_CODES,
  isMillbrookWardCode,
  wardByCode,
  wardLabel,
  normalizeResidenceCode,
  type NycCouncilDistrictCode,
  type MillbrookWardCode,
};

export function isSimRegionCode(code: string): code is SimRegionCode {
  return SIM_REGION_CODES.includes(code.trim().toUpperCase() as SimRegionCode);
}

export function simRegionByCode(code: string) {
  const c = code.trim().toUpperCase();
  if (c === NYC_CITY_CODE) return SIM_REGIONS[0];
  return undefined;
}

export function regionEnumForCode(code: string): UsRegion | undefined {
  return simRegionByCode(code)?.region;
}

/** @deprecated Maps legacy codes to a region enum. */
export const STATE_REGION: Record<string, UsRegion> = {
  MB: "northeast_midwest",
  NE: "northeast_midwest",
  SO: "south",
  WE: "west",
};

export function regionForState(state: string): UsRegion | undefined {
  return regionEnumForCode(state) ?? STATE_REGION[state.trim().toUpperCase()];
}

/** Coerce profile residence to NYC (MB). */
export function normalizeSimRegionCode(code: string | null | undefined): SimRegionCode {
  return normalizeResidenceCode(code);
}
