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
    .select("office, phase, leadership_role")
    .in("id", eids);
  const active = (elecs ?? []).filter(
    (e) => e.phase !== "closed" && !e.leadership_role,
  );
  return {
    hasCongress: active.some((e) => e.office === "house" || e.office === "senate"),
    hasPresident: active.some((e) => e.office === "president"),
  };
}

/**
 * Eligibility for filing (party, seat match, one congressional + optional president).
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
    if (!need) return "This Senate race has no state configured; ask an admin to fix it.";
    const st = String(profile?.residence_state ?? "")
      .trim()
      .toUpperCase();
    if (!st || st.length !== 2) {
      return "Set your residence state on the Character page to the state you are running for.";
    }
    if (st !== need) {
      return "You may only file for a Senate seat in your character's residence state.";
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
      return "You are already filed in an active House or Senate race. Wait until that race closes (or ask an admin) before filing for another congressional seat. You may still run for President alongside one congressional filing.";
    }
  }

  return null;
}
