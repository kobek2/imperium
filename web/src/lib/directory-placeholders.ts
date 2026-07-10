/**
 * Default directory figures for empty NYC government roles.
 * When a real player receives the role in `government_role_grants`, they replace these.
 */

import type { DirectoryHolder } from "@/lib/directory-types";

const BIO =
  "Default roster figure for the directory until a player holds this office in Imperium.";

function ph(partialId: string, row: Omit<DirectoryHolder, "id" | "discord_username">): DirectoryHolder {
  return {
    ...row,
    id: `placeholder:${partialId}`,
    discord_username: null,
    isPlaceholder: true,
  };
}

const PLACEHOLDERS: Record<string, Omit<DirectoryHolder, "id" | "discord_username" | "isPlaceholder">> = {
  mayor: {
    character_name: "Eric Adams",
    party: "democrat",
    bio: BIO,
    face_claim_url: null,
    residence_state: "MB",
    home_district_code: null,
  },
  council_spokesperson: {
    character_name: "Zohran Mamdani",
    party: "democrat",
    bio: "State assembly member and democratic-socialist voice for Upper Manhattan; campaigns on rent stabilization, transit equity, and tenant protections.",
    face_claim_url:
      "https://upload.wikimedia.org/wikipedia/commons/3/37/Zohran_Mamdani_05.25.25_%283x4_cropped%29.jpg",
    residence_state: "MB",
    home_district_code: "W02",
  },
  dept_finance: {
    character_name: "Jerome Powell",
    party: "democrat",
    bio: BIO,
    face_claim_url:
      "https://upload.wikimedia.org/wikipedia/commons/9/92/Jerome_H._Powell%2C_Federal_Reserve_Chair.jpg",
    residence_state: "MB",
    home_district_code: null,
  },
  dept_police: {
    character_name: "Olivia Pope",
    party: "democrat",
    bio: BIO,
    face_claim_url:
      "https://upload.wikimedia.org/wikipedia/commons/3/35/Kerry_Washington_in_%282024%29_%28cropped%29.jpg",
    residence_state: "MB",
    home_district_code: null,
  },
  dept_public_works: {
    character_name: "Hillary Clinton",
    party: "democrat",
    bio: BIO,
    face_claim_url:
      "https://upload.wikimedia.org/wikipedia/commons/2/27/Hillary_Clinton_official_Secretary_of_State_portrait_crop.jpg",
    residence_state: "MB",
    home_district_code: null,
  },
  dept_parks: {
    character_name: "Leslie Knope",
    party: "democrat",
    bio: BIO,
    face_claim_url:
      "https://upload.wikimedia.org/wikipedia/commons/f/f9/Peabody_Poehler_2012_%28cropped%29.jpg",
    residence_state: "MB",
    home_district_code: null,
  },
  dept_planning: {
    character_name: "Elizabeth McCord",
    party: "democrat",
    bio: BIO,
    face_claim_url: "https://upload.wikimedia.org/wikipedia/commons/f/ff/T%C3%A9aLeoniJun07.jpg",
    residence_state: "MB",
    home_district_code: null,
  },
};

export function isPlaceholderDirectoryId(id: string | null | undefined): boolean {
  return (id ?? "").startsWith("placeholder:");
}

export function getPlaceholderForRole(roleKey: string): DirectoryHolder | null {
  if (roleKey === "council_member") return null;
  const row = PLACEHOLDERS[roleKey];
  if (!row) return null;
  return ph(roleKey, row);
}

/** @deprecated SCOTUS removed from NYC directory — kept for legacy imports. */
export function mergeAssociateJusticeHolders(
  realSorted: DirectoryHolder[],
  maxSlots: number,
): DirectoryHolder[] {
  return realSorted.slice(0, maxSlots);
}
