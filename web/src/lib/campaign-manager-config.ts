/** Display defaults for Campaign Manager season (authoritative values live in Postgres). */
export const CAMPAIGN_MANAGER_STARTER_PAC_GRANT = 25_000_000;
export const CAMPAIGN_MANAGER_RIVAL_STARTER_TREASURY = 25_000_000;

/** Council session turns per cycle (legacy name: congress). */
export const CAMPAIGN_COUNCIL_TURNS = 5;
/** @deprecated Use CAMPAIGN_COUNCIL_TURNS */
export const CAMPAIGN_CONGRESS_TURNS = CAMPAIGN_COUNCIL_TURNS;

export const CAMPAIGN_ELECTION_TURNS = 10;

/** Turn-based season: 5 council turns then 10 election turns per cycle. */
export const CAMPAIGN_CYCLE_TURNS = CAMPAIGN_COUNCIL_TURNS + CAMPAIGN_ELECTION_TURNS;

export const RIVAL_DIFFICULTY_LABELS = {
  passive: "Passive — slower counters, smaller daily refill",
  normal: "Normal — watches your PAC spend and matches 115%",
  aggressive: "Aggressive — 135% counters, heavier proactive spend",
} as const;

export type RivalDifficulty = keyof typeof RIVAL_DIFFICULTY_LABELS;
