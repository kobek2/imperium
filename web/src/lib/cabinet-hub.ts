import { CABINET_APPOINTMENT_ROLE_KEYS } from "@/config/cabinet-appointment-roles";
import { POLITICAL_ROLE_LABELS } from "@/config/political-roles";

const EXEC_BYPASS = new Set(["president", "admin", "staff_super"]);

/** Any portfolio owner or exec bypass may open `/cabinet` (Chrome “Cabinet” link uses this). */
export function canAccessCabinetOverview(roleKeys: string[]): boolean {
  return roleKeys.some(
    (k) =>
      k === "secretary_of_treasury" ||
      k === "secretary_of_state" ||
      k === "secretary_of_defense" ||
      k === "secretary_of_homeland_security" ||
      k === "attorney_general" ||
      EXEC_BYPASS.has(k),
  );
}

/** Treasury tools: appropriations, tax warnings, etc. */
export function canAccessTreasuryCabinet(roleKeys: string[]): boolean {
  return roleKeys.some((k) => k === "secretary_of_treasury" || EXEC_BYPASS.has(k));
}

export function canAccessStatePortfolio(roleKeys: string[]): boolean {
  return roleKeys.some((k) => k === "secretary_of_state" || EXEC_BYPASS.has(k));
}

export function canAccessDefensePortfolio(roleKeys: string[]): boolean {
  return roleKeys.some((k) => k === "secretary_of_defense" || EXEC_BYPASS.has(k));
}

export function canAccessHomelandPortfolio(roleKeys: string[]): boolean {
  return roleKeys.some((k) => k === "secretary_of_homeland_security" || EXEC_BYPASS.has(k));
}

export function canAccessJusticePortfolio(roleKeys: string[]): boolean {
  return roleKeys.some((k) => k === "attorney_general" || EXEC_BYPASS.has(k));
}

const DASHBOARD_HREF: Partial<Record<string, string>> = {
  secretary_of_treasury: "/cabinet/treasury",
  secretary_of_state: "/cabinet/state",
  secretary_of_defense: "/cabinet/defense",
  secretary_of_homeland_security: "/cabinet/homeland-security",
  attorney_general: "/cabinet/justice",
};

const PORTFOLIO_BLURB: Partial<Record<string, string>> = {
  secretary_of_treasury:
    "Tax accounts, due warnings, daily penalties, and treasury tooling for the active fiscal year.",
  secretary_of_state:
    "Weekly diplomatic hours, bilateral relationship scores, and where you are investing face time.",
  secretary_of_defense:
    "Force readiness, logistics strain, and alliance exercises — spend engagement hours on priorities.",
  secretary_of_homeland_security:
    "Threat index, border caseload, and cyber alerts — coordinate taskings to move the needle.",
  attorney_general:
    "Investigations backlog, civil-rights queue, and public confidence — steer Department of Justice attention.",
};

export type CabinetPortalCard = {
  roleKey: string;
  label: string;
  href: string | null;
  blurb: string;
};

/** One card per nominated cabinet seat; only portfolios with a built route get `href`. */
export function cabinetPortalCards(): CabinetPortalCard[] {
  return [...CABINET_APPOINTMENT_ROLE_KEYS].map((roleKey) => ({
    roleKey,
    label: POLITICAL_ROLE_LABELS[roleKey] ?? roleKey,
    href: DASHBOARD_HREF[roleKey] ?? null,
    blurb:
      PORTFOLIO_BLURB[roleKey] ??
        "This department’s dashboard will open here once its tools are wired into the sim.",
  }));
}
