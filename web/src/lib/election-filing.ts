import type { SupabaseClient } from "@supabase/supabase-js";

const PARTIES = ["democrat", "republican", "independent"] as const;
export type CandidacyParty = (typeof PARTIES)[number];

export function candidacyPartyFromProfile(party: string | null | undefined): CandidacyParty | null {
  const p = String(party ?? "")
    .trim()
    .toLowerCase();
  return PARTIES.includes(p as CandidacyParty) ? (p as CandidacyParty) : null;
}

export type ProfileSeatFields = {
  party: string | null;
  residence_state: string | null;
  home_district_code: string | null;
};

export type ActiveCandidacySlots = {
  /** User has an active (non-closed) filing in any House or Senate race. */
  hasCongress: boolean;
  /** User has an active filing in a presidential race. */
  hasPresident: boolean;
};

function isActiveSeatElection(e: {
  phase: string;
  leadership_role?: string | null;
  filing_window_started_at?: string | null;
}) {
  if (e.phase === "closed" || e.leadership_role) return false;
  if (e.phase === "filing" && !e.filing_window_started_at) return false;
  return true;
}

const ACTIVE_ELECTION_PHASE_PRIORITY: Record<string, number> = {
  general: 3,
  primary: 2,
  filing: 1,
};

const ACTIVE_ELECTION_OFFICE_PRIORITY: Record<string, number> = {
  house: 3,
  senate: 3,
  president: 2,
};

/** Best active seat/president race to open when the player visits `/elections`. */
export async function loadPrimaryActiveElectionId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: myCands } = await supabase.from("election_candidates").select("election_id").eq("user_id", userId);
  const eids = [...new Set((myCands ?? []).map((c) => c.election_id))];
  if (!eids.length) return null;

  const { data: elecs } = await supabase
    .from("elections")
    .select("id, office, phase, leadership_role, filing_window_started_at")
    .in("id", eids);
  const active = (elecs ?? []).filter(isActiveSeatElection);
  if (!active.length) return null;

  active.sort((a, b) => {
    const phaseDelta =
      (ACTIVE_ELECTION_PHASE_PRIORITY[b.phase] ?? 0) - (ACTIVE_ELECTION_PHASE_PRIORITY[a.phase] ?? 0);
    if (phaseDelta !== 0) return phaseDelta;
    return (
      (ACTIVE_ELECTION_OFFICE_PRIORITY[b.office] ?? 0) -
      (ACTIVE_ELECTION_OFFICE_PRIORITY[a.office] ?? 0)
    );
  });

  return active[0]?.id ?? null;
}

export async function loadActiveCandidacySlots(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActiveCandidacySlots> {
  const { data: myCands } = await supabase.from("election_candidates").select("election_id").eq("user_id", userId);
  const eids = [...new Set((myCands ?? []).map((c) => c.election_id))];
  if (!eids.length) return { hasCongress: false, hasPresident: false };

  // Leadership races don't consume a "congressional seat" filing slot — filing for Speaker
  // shouldn't prevent you from filing for a House seat the same cycle. Select
  // leadership_role so we can exclude those rows from the slot count.
  const { data: elecs } = await supabase
    .from("elections")
    .select("office, phase, leadership_role, filing_window_started_at")
    .in("id", eids);
  const active = (elecs ?? []).filter(isActiveSeatElection);
  return {
    hasCongress: active.some((e) => e.office === "house" || e.office === "senate"),
    hasPresident: active.some((e) => e.office === "president"),
  };
}

/**
 * Eligibility for filing (party, seat match, one active House or Senate race + optional president).
 * Does not check filing window or duplicate row in this election.
 */
export function getFilingEligibilityMessage(
  office: string,
  election: { state: string | null; district_code: string | null },
  profile: ProfileSeatFields | null,
  active: ActiveCandidacySlots,
): string | null {
  const p = candidacyPartyFromProfile(profile?.party);
  if (!p) {
    return "Set your party on the Character page before filing. You can change party there any time.";
  }

  if (office === "house") {
    const need = String(election.district_code ?? "")
      .trim()
      .toUpperCase();
    if (!need) return "This House race has no district configured; ask an admin to fix it.";
    const dist = String(profile?.home_district_code ?? "")
      .trim()
      .toUpperCase();
    if (!dist) {
      return "Set your home district on the Character page to the seat you are running for.";
    }
    if (dist !== need) {
      return "You may only file for the House seat that matches your character's home district.";
    }
  } else if (office === "senate") {
    const need = String(election.state ?? "")
      .trim()
      .toUpperCase();
    if (!need) return "This Senate race has no region configured; ask an admin to fix it.";
    const st = String(profile?.residence_state ?? "")
      .trim()
      .toUpperCase();
    if (!st || !["NE", "SO", "WE"].includes(st)) {
      return "Set your home region on the Character page (NE, SO, or WE).";
    }
    if (st !== need) {
      return "You may only file for a Senate seat in your character's home region.";
    }
  } else if (office !== "president") {
    return "Unknown office type.";
  }

  if (office === "president") {
    if (active.hasPresident) {
      return "You are already filed in an active presidential race.";
    }
  } else if (office === "house" || office === "senate") {
    if (active.hasCongress) {
      return "You are already filed in an active House or Senate race. Withdraw that filing on the race page first if you want to run for a different seat. You may still run for President alongside one House or Senate race.";
    }
  }

  return null;
}
