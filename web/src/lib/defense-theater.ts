/** Primary defense posture mechanisms (matches DB check on `rp_defense_theater_posture.primary_mechanism`). */
export const DEFENSE_THEATER_MECHANISMS = [
  "advise_and_assist",
  "joint_training_exercise",
  "forward_presence",
  "maritime_security_patrol",
  "air_component_operations",
  "integrated_air_missile_defense",
  "security_force_assistance",
  "counterterror_support",
  "humanitarian_assistance",
  "cyber_defense_cooperation",
  "logistics_enabler_access",
] as const;

export type DefenseTheaterMechanism = (typeof DEFENSE_THEATER_MECHANISMS)[number];

export const DEFENSE_THEATER_MECHANISM_LABELS: Record<DefenseTheaterMechanism, string> = {
  advise_and_assist: "Advise & assist",
  joint_training_exercise: "Joint training / exercise",
  forward_presence: "Forward presence / deterrent posture",
  maritime_security_patrol: "Maritime security & patrol",
  air_component_operations: "Air component operations",
  integrated_air_missile_defense: "Integrated air & missile defense",
  security_force_assistance: "Security force assistance",
  counterterror_support: "Counterterror support",
  humanitarian_assistance: "Humanitarian assistance",
  cyber_defense_cooperation: "Cyber defense cooperation",
  logistics_enabler_access: "Logistics & enabler access",
};

export const DEFENSE_PRIORITY_TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: "Critical / pacing theater",
  2: "Elevated priority",
  3: "Routine cooperation",
};

export function isDefenseTheaterMechanism(v: string): v is DefenseTheaterMechanism {
  return (DEFENSE_THEATER_MECHANISMS as readonly string[]).includes(v);
}

/** Plain-English mission style for each country (maps to `primary_mechanism` in the database). */
export const DEFENSE_FOCUS_STYLE_OPTIONS = [
  { id: "allies_training", label: "Train with allies", mechanism: "joint_training_exercise" as const },
  { id: "ships_skies", label: "Ships, skies & coastlines", mechanism: "maritime_security_patrol" as const },
  { id: "boots", label: "Boots on the ground", mechanism: "forward_presence" as const },
  { id: "shields", label: "Missile shields & air cover", mechanism: "integrated_air_missile_defense" as const },
  { id: "partner_up", label: "Help partner forces level up", mechanism: "security_force_assistance" as const },
  { id: "hunt", label: "Hunt terror & insurgents", mechanism: "counterterror_support" as const },
  { id: "helos", label: "Helos & close air support", mechanism: "air_component_operations" as const },
  { id: "convoys", label: "Trucks, fuel & supply lines", mechanism: "logistics_enabler_access" as const },
  { id: "cyber", label: "Cyber defense", mechanism: "cyber_defense_cooperation" as const },
  { id: "relief", label: "Disaster relief & aid", mechanism: "humanitarian_assistance" as const },
  { id: "quiet_advise", label: "Quiet advisors", mechanism: "advise_and_assist" as const },
] as const;

export type DefenseFocusStyleId = (typeof DEFENSE_FOCUS_STYLE_OPTIONS)[number]["id"];

export function focusStyleIdToMechanism(id: string): DefenseTheaterMechanism | null {
  const row = DEFENSE_FOCUS_STYLE_OPTIONS.find((o) => o.id === id);
  return row ? row.mechanism : null;
}

export function defaultFocusStyleIdForMechanism(m: string): DefenseFocusStyleId {
  const hit = DEFENSE_FOCUS_STYLE_OPTIONS.find((o) => o.mechanism === m);
  return (hit?.id ?? "allies_training") as DefenseFocusStyleId;
}
