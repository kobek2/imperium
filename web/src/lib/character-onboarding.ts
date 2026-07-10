import { isNycCouncilDistrictCode, NYC_CITY_CODE } from "@/lib/city";

export type ProfileOnboardingFields = {
  character_name: string | null;
  date_of_birth: string | null;
  residence_state: string | null;
  home_district_code: string | null;
  party: string | null;
};

const PARTIES = new Set(["democrat", "republican", "independent"]);

/**
 * True when the player has supplied the minimum character record needed to use the sim
 * (name, DOB, party, NYC residence, council district W01–W07). Bios are optional.
 */
export function isProfileOnboardingComplete(row: ProfileOnboardingFields | null | undefined): boolean {
  if (!row) return false;
  const name = (row.character_name ?? "").trim();
  if (name.length < 1) return false;
  if (!(row.date_of_birth ?? "").trim()) return false;
  const party = row.party;
  if (!party || !PARTIES.has(party)) return false;
  const region = (row.residence_state ?? "").trim().toUpperCase();
  if (region !== NYC_CITY_CODE) return false;
  const dist = (row.home_district_code ?? "").trim().toUpperCase();
  if (!isNycCouncilDistrictCode(dist)) return false;
  return true;
}
