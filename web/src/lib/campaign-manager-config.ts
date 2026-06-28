/** Display defaults for Campaign Manager season (authoritative values live in Postgres). */
export const CAMPAIGN_MANAGER_STARTER_PAC_GRANT = 25_000_000;
export const CAMPAIGN_MANAGER_RIVAL_STARTER_TREASURY = 25_000_000;

/** CST day split: midnight–noon elections, noon–midnight congress. */
export const CAMPAIGN_DAY_ELECTION_HOURS = "12:00 AM – 11:59 AM CST";
export const CAMPAIGN_DAY_CONGRESS_HOURS = "12:00 PM – 11:59 PM CST";

export const RIVAL_DIFFICULTY_LABELS = {
  passive: "Passive — slower counters, smaller daily refill",
  normal: "Normal — watches your PAC spend and matches 115%",
  aggressive: "Aggressive — 135% counters, heavier proactive spend",
} as const;

export type RivalDifficulty = keyof typeof RIVAL_DIFFICULTY_LABELS;
