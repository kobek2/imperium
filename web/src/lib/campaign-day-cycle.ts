/** Campaign Manager turn rhythm — 5 council session turns + 10 election turns per cycle. */

import { CAMPAIGN_COUNCIL_TURNS, CAMPAIGN_ELECTION_TURNS } from "@/lib/campaign-manager-config";

export { CAMPAIGN_COUNCIL_TURNS, CAMPAIGN_ELECTION_TURNS };
/** @deprecated Use CAMPAIGN_COUNCIL_TURNS */
export const CAMPAIGN_CONGRESS_TURNS = CAMPAIGN_COUNCIL_TURNS;
export const CAMPAIGN_CYCLE_TURNS = CAMPAIGN_COUNCIL_TURNS + CAMPAIGN_ELECTION_TURNS;

export type CampaignDayPhase = "elections" | "council";

/** @deprecated Use CampaignDayPhase with council */
export type LegacyCampaignDayPhase = "elections" | "congress";

export type CampaignDayCycle = CampaignTurnCycle;

export type CampaignTurnCycle = {
  phase: CampaignDayPhase;
  cycle: number;
  turn: number;
  turnInPhase: number;
  turnsInPhase: number;
  councilTurns: number;
  /** @deprecated Use councilTurns */
  congressTurns: number;
  electionTurns: number;
  cycleTurns: number;
  phaseLabel: string;
  phaseDescription: string;
};

export function buildCampaignTurnCycle(input: {
  turn: number;
  cycle: number;
  councilTurns?: number;
  /** @deprecated Use councilTurns */
  congressTurns?: number;
  electionTurns?: number;
}): CampaignTurnCycle {
  const councilTurns = input.councilTurns ?? input.congressTurns ?? CAMPAIGN_COUNCIL_TURNS;
  const electionTurns = input.electionTurns ?? CAMPAIGN_ELECTION_TURNS;
  const cycleTurns = councilTurns + electionTurns;
  const turn = Math.min(Math.max(input.turn, 1), cycleTurns);
  const phase: CampaignDayPhase = turn <= councilTurns ? "council" : "elections";
  const turnInPhase = phase === "council" ? turn : turn - councilTurns;
  const turnsInPhase = phase === "council" ? councilTurns : electionTurns;

  if (phase === "elections") {
    return {
      phase,
      cycle: input.cycle,
      turn,
      turnInPhase,
      turnsInPhase,
      councilTurns,
      congressTurns: councilTurns,
      electionTurns,
      cycleTurns,
      phaseLabel: `Election turns · ${turnInPhase} of ${turnsInPhase}`,
      phaseDescription: "PAC spending and race tracking for mayor + ward seats. Counter-spends trigger when you file contributions.",
    };
  }
  return {
    phase,
    cycle: input.cycle,
    turn,
    turnInPhase,
    turnsInPhase,
    councilTurns,
    congressTurns: councilTurns,
    electionTurns,
    cycleTurns,
    phaseLabel: `Council session · ${turnInPhase} of ${turnsInPhase}`,
    phaseDescription: "Run one legislative round per turn — nominate spokesperson (turn 1), propose ordinances, whip votes, mayor sign/veto. Staff advances the sim week when the session is ready.",
  };
}

export function getCampaignDayCycle(): CampaignTurnCycle {
  return buildCampaignTurnCycle({ turn: 1, cycle: 1 });
}

export function isElectionActionsAllowed(cycle: CampaignTurnCycle): boolean {
  return cycle.phase === "elections";
}

export function isCouncilActionsAllowed(cycle: CampaignTurnCycle): boolean {
  return cycle.phase === "council";
}

/** @deprecated Use isCouncilActionsAllowed */
export function isCongressActionsAllowed(cycle: CampaignTurnCycle): boolean {
  return isCouncilActionsAllowed(cycle);
}

export function formatTurnPosition(cycle: CampaignTurnCycle): string {
  return `Cycle ${cycle.cycle} · Turn ${cycle.turn}/${cycle.cycleTurns}`;
}

/** Normalize RPC phase string (legacy congress → council). */
export function normalizeCampaignPhase(raw: string | null | undefined): CampaignDayPhase {
  if (raw === "elections") return "elections";
  return "council";
}
