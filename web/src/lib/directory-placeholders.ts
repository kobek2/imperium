/**
 * Default directory figures for empty government roles (RL names as placeholders).
 * When a real player receives the role in `government_role_grants`, they replace these.
 * House/Senate rank-and-file (435 + 100) are intentionally excluded.
 *
 * `face_claim_url` uses stable Wikimedia Commons URLs (mostly federal official portraits).
 * You may also use same-origin paths such as `/directory-placeholders/president.jpg`.
 */

import type { DirectoryHolder } from "@/lib/directory-types";

const BIO =
  "Default roster figure for the directory until a player holds this office in Imperium.";

/** HTTPS portrait URLs (Wikimedia Commons). */
const WIKI = {
  president:
    "https://upload.wikimedia.org/wikipedia/commons/6/68/Joe_Biden_presidential_portrait.jpg",
  vice_president:
    "https://upload.wikimedia.org/wikipedia/commons/4/41/Kamala_Harris_Vice_Presidential_Portrait.jpg",
  speaker:
    "https://upload.wikimedia.org/wikipedia/commons/b/b9/Mike_Johnson_official_portrait%2C_118th_Congress.jpg",
  president_pro_tempore:
    "https://upload.wikimedia.org/wikipedia/commons/4/4f/Patty_Murray%2C_official_portrait%2C_113th_Congress.jpg",
  chief_justice: "https://upload.wikimedia.org/wikipedia/commons/4/43/Official_roberts_CJ.jpg",
  house_majority_leader:
    "https://upload.wikimedia.org/wikipedia/commons/3/34/Steve_Scalise_116th_Congress_official_photo.jpg",
  house_majority_whip:
    "https://upload.wikimedia.org/wikipedia/commons/5/5d/Tom_Emmer%2C_official_portrait_114th_Congress_%283x4%29.jpg",
  house_minority_leader:
    "https://upload.wikimedia.org/wikipedia/commons/a/a6/Rep-Hakeem-Jeffries-Official-Portrait_%28cropped%29.jpg",
  house_minority_whip:
    "https://upload.wikimedia.org/wikipedia/commons/7/79/Katherine_Clark%2C_official_portrait%2C_118th_Congress_%28tight_crop%29.jpg",
  senate_majority_leader:
    "https://upload.wikimedia.org/wikipedia/commons/8/89/Chuck_Schumer_official_photo.jpg",
  senate_majority_whip:
    "https://upload.wikimedia.org/wikipedia/commons/a/a8/Dick_Durbin_2022_official_portrait_%28cropped%29.jpg",
  senate_minority_leader:
    "https://upload.wikimedia.org/wikipedia/commons/d/dc/John_Thune%2C_official_portrait%2C_111th_Congress.jpg",
  senate_minority_whip:
    "https://upload.wikimedia.org/wikipedia/commons/b/b3/John_Barrasso%2C_official_portrait%2C_112th_Congress.jpg",
  chief_of_staff: "https://upload.wikimedia.org/wikipedia/commons/4/45/Jeff_Zients%2C_WHCOS.jpg",
  secretary_of_state: "https://upload.wikimedia.org/wikipedia/commons/4/4a/Antony_Blinken.jpg",
  secretary_of_treasury:
    "https://upload.wikimedia.org/wikipedia/commons/4/45/Janet_Yellen_official_CEA_portrait.jpg",
  attorney_general: "https://upload.wikimedia.org/wikipedia/commons/f/f9/Merrick_Garland.jpg",
  secretary_of_defense:
    "https://upload.wikimedia.org/wikipedia/commons/1/14/Secretary_of_Defense_Lloyd_Austin%2C_official_portrait%2C_2023.jpg",
  secretary_of_homeland_security:
    "https://upload.wikimedia.org/wikipedia/commons/4/49/Alejandro_Mayorkas%2C_United_States_Secretary_of_Homeland_Security.jpg",
  secretary_of_health_and_human_services:
    "https://upload.wikimedia.org/wikipedia/commons/b/b6/Xavier_Becerra_official_portrait.jpg",
  secretary_of_transportation:
    "https://upload.wikimedia.org/wikipedia/commons/2/25/Pete_Buttigieg_official_photo_%28cropped%29.jpg",
  secretary_of_energy:
    "https://upload.wikimedia.org/wikipedia/commons/6/69/Secretary_Jennifer_Granholm.jpg",
  secretary_of_interior:
    "https://upload.wikimedia.org/wikipedia/commons/7/75/Deb_Haaland%2C_official_portrait%2C_116th_Congress.jpg",
  secretary_of_agriculture:
    "https://upload.wikimedia.org/wikipedia/commons/0/07/Tom_Vilsack%2C_official_USDA_portrait_%28cropped%29.jpg",
  secretary_of_commerce: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Gina_Raimondo.jpg",
  secretary_of_education:
    "https://upload.wikimedia.org/wikipedia/commons/9/9b/Secretary_of_Education_Miguel_Cardona%2C_official_portrait.jpg",
  secretary_of_veterans_affairs:
    "https://upload.wikimedia.org/wikipedia/commons/0/08/Denis_McDonough-White_House.jpg",
  secretary_of_housing_and_urban_development:
    "https://upload.wikimedia.org/wikipedia/commons/3/38/Marcia_Fudge_official_photo.jpg",
} as const;

export function isPlaceholderDirectoryId(id: string | null | undefined): boolean {
  return (id ?? "").startsWith("placeholder:");
}

function ph(partialId: string, row: Omit<DirectoryHolder, "id" | "discord_username">): DirectoryHolder {
  return {
    ...row,
    id: `placeholder:${partialId}`,
    discord_username: null,
    isPlaceholder: true,
  };
}

const PLACEHOLDERS: Record<string, Omit<DirectoryHolder, "id" | "discord_username" | "isPlaceholder">> = {
  president: {
    character_name: "Joe Biden",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.president,
    residence_state: "DE",
    home_district_code: null,
  },
  vice_president: {
    character_name: "Kamala Harris",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.vice_president,
    residence_state: "CA",
    home_district_code: null,
  },
  speaker: {
    character_name: "Mike Johnson",
    party: "republican",
    bio: BIO,
    face_claim_url: WIKI.speaker,
    residence_state: "LA",
    home_district_code: "LA-04",
  },
  president_pro_tempore: {
    character_name: "Patty Murray",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.president_pro_tempore,
    residence_state: "WA",
    home_district_code: null,
  },
  chief_justice: {
    character_name: "John G. Roberts, Jr.",
    party: "independent",
    bio: BIO,
    face_claim_url: WIKI.chief_justice,
    residence_state: null,
    home_district_code: null,
  },
  house_majority_leader: {
    character_name: "Steve Scalise",
    party: "republican",
    bio: BIO,
    face_claim_url: WIKI.house_majority_leader,
    residence_state: "LA",
    home_district_code: "LA-01",
  },
  house_majority_whip: {
    character_name: "Tom Emmer",
    party: "republican",
    bio: BIO,
    face_claim_url: WIKI.house_majority_whip,
    residence_state: "MN",
    home_district_code: "MN-06",
  },
  house_minority_leader: {
    character_name: "Hakeem Jeffries",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.house_minority_leader,
    residence_state: "NY",
    home_district_code: "NY-08",
  },
  house_minority_whip: {
    character_name: "Katherine Clark",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.house_minority_whip,
    residence_state: "MA",
    home_district_code: "MA-05",
  },
  senate_majority_leader: {
    character_name: "Chuck Schumer",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.senate_majority_leader,
    residence_state: "NY",
    home_district_code: null,
  },
  senate_majority_whip: {
    character_name: "Dick Durbin",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.senate_majority_whip,
    residence_state: "IL",
    home_district_code: null,
  },
  senate_minority_leader: {
    character_name: "John Thune",
    party: "republican",
    bio: BIO,
    face_claim_url: WIKI.senate_minority_leader,
    residence_state: "SD",
    home_district_code: null,
  },
  senate_minority_whip: {
    character_name: "John Barrasso",
    party: "republican",
    bio: BIO,
    face_claim_url: WIKI.senate_minority_whip,
    residence_state: "WY",
    home_district_code: null,
  },
  chief_of_staff: {
    character_name: "Jeff Zients",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.chief_of_staff,
    residence_state: null,
    home_district_code: null,
  },
  secretary_of_state: {
    character_name: "Antony Blinken",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.secretary_of_state,
    residence_state: "VA",
    home_district_code: null,
  },
  secretary_of_treasury: {
    character_name: "Janet Yellen",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.secretary_of_treasury,
    residence_state: "CA",
    home_district_code: null,
  },
  attorney_general: {
    character_name: "Merrick Garland",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.attorney_general,
    residence_state: "MD",
    home_district_code: null,
  },
  secretary_of_defense: {
    character_name: "Lloyd Austin",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.secretary_of_defense,
    residence_state: null,
    home_district_code: null,
  },
  secretary_of_homeland_security: {
    character_name: "Alejandro Mayorkas",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.secretary_of_homeland_security,
    residence_state: null,
    home_district_code: null,
  },
  secretary_of_health_and_human_services: {
    character_name: "Xavier Becerra",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.secretary_of_health_and_human_services,
    residence_state: "CA",
    home_district_code: null,
  },
  secretary_of_transportation: {
    character_name: "Pete Buttigieg",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.secretary_of_transportation,
    residence_state: "MI",
    home_district_code: null,
  },
  secretary_of_energy: {
    character_name: "Jennifer Granholm",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.secretary_of_energy,
    residence_state: "MI",
    home_district_code: null,
  },
  secretary_of_interior: {
    character_name: "Deb Haaland",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.secretary_of_interior,
    residence_state: "NM",
    home_district_code: null,
  },
  secretary_of_agriculture: {
    character_name: "Tom Vilsack",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.secretary_of_agriculture,
    residence_state: "IA",
    home_district_code: null,
  },
  secretary_of_commerce: {
    character_name: "Gina Raimondo",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.secretary_of_commerce,
    residence_state: "RI",
    home_district_code: null,
  },
  secretary_of_education: {
    character_name: "Miguel Cardona",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.secretary_of_education,
    residence_state: "CT",
    home_district_code: null,
  },
  secretary_of_veterans_affairs: {
    character_name: "Denis McDonough",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.secretary_of_veterans_affairs,
    residence_state: "MD",
    home_district_code: null,
  },
  secretary_of_housing_and_urban_development: {
    character_name: "Marcia Fudge",
    party: "democrat",
    bio: BIO,
    face_claim_url: WIKI.secretary_of_housing_and_urban_development,
    residence_state: "OH",
    home_district_code: null,
  },
};

const ASSOCIATE_JUSTICE_SLOTS: Array<{
  character_name: string;
  party: DirectoryHolder["party"];
  residence_state: string | null;
  face_claim_url: string;
}> = [
  {
    character_name: "Clarence Thomas",
    party: "republican",
    residence_state: "VA",
    face_claim_url:
      "https://upload.wikimedia.org/wikipedia/commons/5/58/Clarence_Thomas_official_SCOTUS_portrait.jpg",
  },
  {
    character_name: "Samuel A. Alito, Jr.",
    party: "republican",
    residence_state: "NJ",
    face_claim_url: "https://upload.wikimedia.org/wikipedia/commons/a/ac/Samuel_Alito_official_photo.jpg",
  },
  {
    character_name: "Sonia Sotomayor",
    party: "democrat",
    residence_state: "NY",
    face_claim_url: "https://upload.wikimedia.org/wikipedia/commons/9/92/Sonia_Sotomayor_portrait.jpg",
  },
  {
    character_name: "Elena Kagan",
    party: "democrat",
    residence_state: "DC",
    face_claim_url:
      "https://upload.wikimedia.org/wikipedia/commons/c/ce/Elena_Kagan_Official_SCOTUS_Portrait_%282013%29.jpg",
  },
  {
    character_name: "Neil M. Gorsuch",
    party: "republican",
    residence_state: "CO",
    face_claim_url:
      "https://upload.wikimedia.org/wikipedia/commons/c/c8/Associate_Justice_Neil_Gorsuch_Official_Portrait_%28cropped_2%29.jpg",
  },
  {
    character_name: "Brett M. Kavanaugh",
    party: "republican",
    residence_state: "MD",
    face_claim_url:
      "https://upload.wikimedia.org/wikipedia/commons/3/37/Associate_Justice_Brett_Kavanaugh_Official_Portrait_%28full_length%29.jpg",
  },
  {
    character_name: "Amy Coney Barrett",
    party: "republican",
    residence_state: "IN",
    face_claim_url: "https://upload.wikimedia.org/wikipedia/commons/f/f2/Amy_Coney_Barrett_official_portrait.jpg",
  },
  {
    character_name: "Ketanji Brown Jackson",
    party: "democrat",
    residence_state: "DC",
    face_claim_url:
      "https://upload.wikimedia.org/wikipedia/commons/d/d6/Ketanji_Brown_Jackson_official_SCOTUS_portrait.jpg",
  },
];

export function getPlaceholderForRole(roleKey: string): DirectoryHolder | null {
  if (roleKey === "representative" || roleKey === "senator") return null;
  const row = PLACEHOLDERS[roleKey];
  if (!row) return null;
  return ph(roleKey, row);
}

/** Fill up to `maxSlots` Associate Justice tiles; real holders occupy early slots. */
export function mergeAssociateJusticeHolders(
  realSorted: DirectoryHolder[],
  maxSlots: number,
): DirectoryHolder[] {
  const trimmed = realSorted.slice(0, maxSlots);
  const out: DirectoryHolder[] = [];
  for (let i = 0; i < maxSlots; i++) {
    const r = trimmed[i];
    if (r) {
      out.push(r);
      continue;
    }
    const slot = ASSOCIATE_JUSTICE_SLOTS[i];
    if (!slot) break;
    out.push(
      ph(`associate_justice:${i}`, {
        character_name: slot.character_name,
        party: slot.party,
        bio: BIO,
        face_claim_url: slot.face_claim_url,
        residence_state: slot.residence_state,
        home_district_code: null,
      }),
    );
  }
  return out;
}
