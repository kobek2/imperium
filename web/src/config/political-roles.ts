/**
 * Canonical keys aligned with Discord polsim role names.
 * NYC city roles are primary; federal keys remain for legacy routes.
 */

export const POLITICAL_ROLE_LABELS: Record<string, string> = {
  // New York City government
  mayor: "Mayor of New York City",
  council_member: "New York City Council",
  council_spokesperson: "Council Spokesperson",
  dept_finance: "Commissioner of Finance",
  dept_police: "Police Commissioner",
  dept_public_works: "Commissioner of Public Works",
  dept_parks: "Commissioner of Parks & Recreation",
  dept_planning: "Director of City Planning",
  caucus_council_democrats: "Council Democrats",
  caucus_council_republicans: "Council Republicans",
  // Legacy federal (archived — not shown in primary NYC directory)
  president: "President of the United States (archived)",
  vice_president: "Vice President of the United States (archived)",
  cabinet: "Cabinet",
  chief_justice: "Chief Justice of the Supreme Court of the United States",
  associate_justice: "Associate Justice of the Supreme Court of the United States",
  speaker: "Speaker of the House",
  president_pro_tempore: "President Pro Tempore",
  senate_majority_leader: "Senate Majority Leader",
  senate_majority_whip: "Senate Majority Whip",
  senate_minority_leader: "Senate Minority Leader",
  senate_minority_whip: "Senate Minority Whip",
  senate_deputy: "Senate Deputy (floor & hopper backup)",
  house_majority_leader: "House Majority Leader",
  house_majority_whip: "House Majority Whip",
  house_minority_leader: "House Minority Leader",
  house_minority_whip: "House Minority Whip",
  house_deputy: "House Deputy (floor & hopper backup)",
  governor: "Governor",
  senator: "Senator",
  representative: "Representative",
  party_democrat: "Democrat",
  party_republican: "Republican",
  citizen: "Citizen",
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
  caucus_senate_democrats: "Senate Democrats",
  caucus_senate_republicans: "Senate Republicans",
  caucus_house_democrats: "House Democrats",
  caucus_house_republicans: "House Republicans",
  admin: "Imperium Admin",
  staff_super: "Staff (full)",
  staff_accounts: "Staff · Accounts",
  staff_roles: "Staff · Roles",
  staff_economy: "Staff · Economy",
  staff_elections: "Staff · Elections",
  staff_parties: "Staff · Parties",
  staff_simulation: "Staff · Simulation",
};

/** Keys we accept from Discord / DB (excluding admin which is manual). */
export const KNOWN_POLITICAL_ROLE_KEYS = new Set(Object.keys(POLITICAL_ROLE_LABELS));

/** Active NYC city gameplay roles. */
export const CITY_ROLE_KEYS = [
  "mayor",
  "council_member",
  "council_spokesperson",
  "dept_finance",
  "dept_police",
  "dept_public_works",
  "dept_parks",
  "dept_planning",
] as const;
