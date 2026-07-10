/** New York City — single playable city (DB city code remains MB for migration compatibility). */

export const NYC_CITY_CODE = "MB" as const;
export const NYC_CITY_NAME = "New York City";

/** @deprecated Use NYC_CITY_CODE */
export const MILLBROOK_CITY_CODE = NYC_CITY_CODE;
/** @deprecated Use NYC_CITY_NAME */
export const MILLBROOK_CITY_NAME = NYC_CITY_NAME;

/** Seven council districts — matches seeded wards in DB (W01–W07). Positive PVI = D lean; negative = R lean. */
export const NYC_COUNCIL_DISTRICTS = [
  {
    code: "W01",
    name: "Lower Manhattan & Financial District",
    borough: "Manhattan",
    pvi: 18,
    incumbentName: "Kamala Harris",
    incumbentParty: "democrat" as const,
  },
  {
    code: "W02",
    name: "Upper Manhattan",
    borough: "Manhattan",
    pvi: 32,
    incumbentName: "Zohran Mamdani",
    incumbentParty: "democrat" as const,
  },
  {
    code: "W03",
    name: "South Brooklyn",
    borough: "Brooklyn",
    pvi: 8,
    incumbentName: "Gavin Newsom",
    incumbentParty: "democrat" as const,
  },
  {
    code: "W04",
    name: "North Brooklyn",
    borough: "Brooklyn",
    pvi: 28,
    incumbentName: "Alexandria Ocasio-Cortez",
    incumbentParty: "democrat" as const,
  },
  {
    code: "W05",
    name: "South Queens",
    borough: "Queens",
    pvi: -6,
    incumbentName: "Marco Rubio",
    incumbentParty: "republican" as const,
  },
  {
    code: "W06",
    name: "South Bronx",
    borough: "Bronx",
    pvi: -4,
    incumbentName: "Mike Johnson",
    incumbentParty: "republican" as const,
  },
  {
    code: "W07",
    name: "Staten Island North",
    borough: "Staten Island",
    pvi: -12,
    incumbentName: "Donald Trump",
    incumbentParty: "republican" as const,
  },
] as const;

/** @deprecated Use NYC_COUNCIL_DISTRICTS */
export const MILLBROOK_WARDS = NYC_COUNCIL_DISTRICTS;

export type NycCouncilDistrictCode = (typeof NYC_COUNCIL_DISTRICTS)[number]["code"];
/** @deprecated Use NycCouncilDistrictCode */
export type MillbrookWardCode = NycCouncilDistrictCode;

export const NYC_COUNCIL_DISTRICT_CODES = NYC_COUNCIL_DISTRICTS.map((w) => w.code) as NycCouncilDistrictCode[];
/** @deprecated Use NYC_COUNCIL_DISTRICT_CODES */
export const MILLBROOK_WARD_CODES = NYC_COUNCIL_DISTRICT_CODES;

const WARD_SET = new Set<string>(NYC_COUNCIL_DISTRICT_CODES);

export function isNycCouncilDistrictCode(code: string): code is NycCouncilDistrictCode {
  return WARD_SET.has(code.trim().toUpperCase());
}

/** @deprecated Use isNycCouncilDistrictCode */
export function isMillbrookWardCode(code: string): code is NycCouncilDistrictCode {
  return isNycCouncilDistrictCode(code);
}

export function councilDistrictByCode(code: string) {
  const c = code.trim().toUpperCase();
  return NYC_COUNCIL_DISTRICTS.find((w) => w.code === c);
}

/** @deprecated Use councilDistrictByCode */
export function wardByCode(code: string) {
  return councilDistrictByCode(code);
}

export function formatDistrictPvi(pvi: number): string {
  if (pvi > 0) return `D+${pvi}`;
  if (pvi < 0) return `R+${Math.abs(pvi)}`;
  return "EVEN";
}

export function councilDistrictLabel(code: string): string {
  const w = councilDistrictByCode(code);
  if (!w) return code;
  return `District ${w.code.slice(1)} · ${w.borough} (${w.name})`;
}

/** @deprecated Use councilDistrictLabel */
export function wardLabel(code: string): string {
  return councilDistrictLabel(code);
}

/** Default residence for onboarding — all players live in NYC (MB). */
export function normalizeResidenceCode(code: string | null | undefined): typeof NYC_CITY_CODE {
  void code;
  return NYC_CITY_CODE;
}

export const CITY_ELECTION_OFFICES = ["mayor", "council_ward"] as const;

export function isCityElectionOffice(office: string): boolean {
  return (CITY_ELECTION_OFFICES as readonly string[]).includes(office);
}

export function electionSeatHeadline(e: {
  office: string;
  ward_code?: string | null;
}): string {
  if (e.office === "mayor") return `Mayor of ${NYC_CITY_NAME}`;
  if (e.office === "council_ward") {
    const w = e.ward_code;
    return w ? `City Council · ${councilDistrictLabel(w)}` : `City Council · ${NYC_CITY_NAME}`;
  }
  return e.office;
}

export function electionSeatSubhead(e: { office: string; ward_code?: string | null }): string {
  if (e.office === "mayor") return "Citywide race";
  if (e.office === "council_ward") {
    const w = e.ward_code ? councilDistrictByCode(e.ward_code) : null;
    return w ? `${w.borough} council district` : "Council district race";
  }
  return "";
}
