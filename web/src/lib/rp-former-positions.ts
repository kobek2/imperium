/** US state names for RP boilerplate (two-letter codes as stored on profiles). */
const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

export function formatStateNameForRp(code: string | null | undefined): string {
  const c = (code ?? "").trim().toUpperCase();
  if (!c) return "their home state";
  return US_STATE_NAMES[c] ?? c;
}

/**
 * Default “Former positions (RP)” copy when the player has not written their own.
 * Party and residence state personalize the senator line and chair / nominee labels.
 */
export function defaultFormerPositionsRp(party: string | null | undefined, stateCode: string | null | undefined): string {
  const state = formatStateNameForRp(stateCode);
  const p = (party ?? "").trim().toLowerCase();
  if (p === "republican") {
    return [
      "Chairman of the Republican Party: 1/1/24 - Present",
      `Senator for ${state}: 1/1/24 - Present`,
      "Republican Nominee for President of the United States: 2024",
    ].join("\n");
  }
  if (p === "democrat") {
    return [
      "Chairman of the Democratic Party: 1/1/24 - Present",
      `Senator for ${state}: 1/1/24 - Present`,
      "Democratic Nominee for President of the United States: 2024",
    ].join("\n");
  }
  return [
    "Independent Party Chair: 1/1/24 - Present",
    `Senator for ${state}: 1/1/24 - Present`,
    "Independent candidate for President of the United States: 2024",
  ].join("\n");
}

/** Stored text wins when non-empty; otherwise show generated RP defaults. */
export function displayFormerPositionsRp(
  stored: string | null | undefined,
  party: string | null | undefined,
  stateCode: string | null | undefined,
): string {
  const t = (stored ?? "").trim();
  if (t) return t;
  return defaultFormerPositionsRp(party, stateCode);
}
