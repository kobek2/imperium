import { SIM_REGION_CODES } from "@/lib/regions";

export type ProfileOnboardingFields = {
  character_name: string | null;
  date_of_birth: string | null;
  residence_state: string | null;
  home_district_code: string | null;
  party: string | null;
};

const REGION_SET = new Set<string>(SIM_REGION_CODES);

const PARTIES = new Set(["democrat", "republican", "independent"]);

/**
 * True when the player has supplied the minimum character record needed to use the sim
 * (name, DOB, party, region, House home district). Bios are optional.
 */
export function isProfileOnboardingComplete(row: ProfileOnboardingFields | null | undefined): boolean {
  if (!row) return false;
  const name = (row.character_name ?? "").trim();
  if (name.length < 1) return false;
  if (!(row.date_of_birth ?? "").trim()) return false;
  const party = row.party;
  if (!party || !PARTIES.has(party)) return false;
  const region = (row.residence_state ?? "").trim().toUpperCase();
  if (!REGION_SET.has(region)) return false;
  const dist = (row.home_district_code ?? "").trim().toUpperCase();
  if (!/^(NE|SO|WE)-\d{2}$/.test(dist)) return false;
  return true;
}
