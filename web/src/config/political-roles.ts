/**
 * Canonical keys aligned with typical Discord polsim role names.
 * Store these in `government_role_grants.role_key` (synced from Discord by the bot).
 * Legacy `profiles.office_role` still works for a single role (e.g. `admin`, `speaker`).
 */

export const POLITICAL_ROLE_LABELS: Record<string, string> = {
  // Executive & judicial (image 1)
  president: "President of the United States",
  vice_president: "Vice President of the United States",
  cabinet: "Cabinet",
  chief_justice: "Chief Justice of the Supreme Court of the United States",
  associate_justice: "Associate Justice of the Supreme Court of the United States",
  // House / Senate leadership (image 1)
  speaker: "Speaker of the House",
  president_pro_tempore: "President Pro Tempore",
  senate_majority_leader: "Senate Majority Leader",
  senate_majority_whip: "Senate Majority Whip",
  senate_minority_leader: "Senate Minority Leader",
  senate_minority_whip: "Senate Minority Whip",
  house_majority_leader: "House Majority Leader",
  house_majority_whip: "House Majority Whip",
  house_minority_leader: "House Minority Leader",
  house_minority_whip: "House Minority Whip",
  // Membership & party (image 2)
  governor: "Governor",
  senator: "Senator",
  representative: "Representative",
  party_democrat: "Democrat",
  party_republican: "Republican",
  citizen: "Citizen",
  // Cabinet portfolios (images 2–3)
  secretary_of_state: "Secretary of State",
  secretary_of_education: "Secretary of Education",
  secretary_of_defense: "Secretary of Defense",
  secretary_of_homeland_security: "Secretary of Homeland Security",
  secretary_of_commerce: "Secretary of Commerce",
  secretary_of_transportation: "Secretary of Transportation",
  secretary_of_health_and_human_services: "Secretary of Health and Human Services",
  secretary_of_energy: "Secretary of Energy",
  secretary_of_interior: "Secretary of Interior",
  secretary_of_agriculture: "Secretary of Agriculture",
  secretary_of_housing_and_urban_development: "Secretary of Housing and Urban Development",
  secretary_of_veterans_affairs: "Secretary of Veteran Affairs",
  secretary_of_treasury: "Secretary of Treasury",
  attorney_general: "Attorney General",
  chief_of_staff: "Chief of Staff",
  // Caucuses (image 3–4)
  caucus_senate_democrats: "Senate Democrats",
  caucus_senate_republicans: "Senate Republicans",
  caucus_house_democrats: "House Democrats",
  caucus_house_republicans: "House Republicans",
  // Site operator bypass (not a Discord role)
  admin: "Command Center Admin",
};

/** Keys we accept from Discord / DB (excluding admin which is manual). */
export const KNOWN_POLITICAL_ROLE_KEYS = new Set(Object.keys(POLITICAL_ROLE_LABELS));
