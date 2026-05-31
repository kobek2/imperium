export type UsRegion = "northeast_midwest" | "south" | "west";

/** Three playable regions (stored as 2-letter codes in `states` / `profiles.residence_state`). */
export const SIM_REGIONS = [
  {
    code: "NE",
    name: "Northeast & Midwest",
    region: "northeast_midwest" as UsRegion,
    houseDistricts: 3,
  },
  { code: "SO", name: "South", region: "south" as UsRegion, houseDistricts: 3 },
  { code: "WE", name: "West", region: "west" as UsRegion, houseDistricts: 4 },
] as const;

export type SimRegionCode = (typeof SIM_REGIONS)[number]["code"];

export const SIM_REGION_CODES = SIM_REGIONS.map((r) => r.code) as SimRegionCode[];

const CODE_SET = new Set<string>(SIM_REGION_CODES);

export function isSimRegionCode(code: string): code is SimRegionCode {
  return CODE_SET.has(code.trim().toUpperCase());
}

export function simRegionByCode(code: string) {
  const c = code.trim().toUpperCase();
  return SIM_REGIONS.find((r) => r.code === c);
}

export function regionEnumForCode(code: string): UsRegion | undefined {
  return simRegionByCode(code)?.region;
}

/** @deprecated Use `regionEnumForCode` — maps legacy IRL state codes to a sim region enum. */
export const STATE_REGION: Record<string, UsRegion> = {
  NE: "northeast_midwest",
  SO: "south",
  WE: "west",
};

export function regionForState(state: string): UsRegion | undefined {
  return regionEnumForCode(state) ?? STATE_REGION[state.trim().toUpperCase()];
}

/** Coerce legacy profile residence codes to a sim region (defaults to NE). */
export function normalizeSimRegionCode(code: string | null | undefined): SimRegionCode {
  const c = String(code ?? "")
    .trim()
    .toUpperCase();
  return isSimRegionCode(c) ? c : "NE";
}
