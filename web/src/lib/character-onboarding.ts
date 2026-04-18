/** Two-letter US state codes (excluding territories) for client + server validation. */
export const US_STATE_CODES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
] as const;

export type ProfileOnboardingFields = {
  character_name: string | null;
  date_of_birth: string | null;
  residence_state: string | null;
  home_district_code: string | null;
  party: string | null;
};

const STATE_SET = new Set<string>(US_STATE_CODES);

const PARTIES = new Set(["democrat", "republican", "independent"]);

/**
 * True when the player has supplied the minimum character record needed to use the sim
 * (name, DOB, party, state, House home district). Bios are optional.
 */
export function isProfileOnboardingComplete(row: ProfileOnboardingFields | null | undefined): boolean {
  if (!row) return false;
  const name = (row.character_name ?? "").trim();
  if (name.length < 1) return false;
  if (!(row.date_of_birth ?? "").trim()) return false;
  const party = row.party;
  if (!party || !PARTIES.has(party)) return false;
  const st = (row.residence_state ?? "").trim().toUpperCase();
  if (!STATE_SET.has(st)) return false;
  const dist = (row.home_district_code ?? "").trim();
  if (!dist) return false;
  return true;
}
