import { CABINET_APPOINTMENT_ROLE_KEYS } from "@/config/cabinet-appointment-roles";
import { POLITICAL_ROLE_LABELS } from "@/config/political-roles";

const EXEC_NAV_BYPASS = new Set(["admin", "staff_super"]);

const CABINET_HUB_ROLE_KEYS = new Set<string>([
  "president",
  "vice_president",
  "cabinet",
  ...CABINET_APPOINTMENT_ROLE_KEYS,
]);

function hasCabinetHubRole(roleKeys: readonly string[]): boolean {
  return roleKeys.some((k) => CABINET_HUB_ROLE_KEYS.has(k));
}

/** President, Vice President, cabinet appointees, or generic `cabinet` grant — department overview and read-only dashboards. */
export function canViewCabinetHub(roleKeys: string[]): boolean {
  return hasCabinetHubRole(roleKeys) || roleKeys.some((k) => EXEC_NAV_BYPASS.has(k));
}

/** Only the sitting portfolio secretary (plus site operators) may run department actions. */
export function canActAsPortfolioSecretary(roleKeys: string[], portfolioRoleKey: string): boolean {
  return (
    roleKeys.includes(portfolioRoleKey) ||
    roleKeys.includes("admin") ||
    roleKeys.includes("staff_super")
  );
}

export function canViewTreasuryDepartment(roleKeys: string[]): boolean {
  return canViewCabinetHub(roleKeys);
}

export function canActAsTreasurySecretary(roleKeys: string[]): boolean {
  return canActAsPortfolioSecretary(roleKeys, "secretary_of_treasury");
}

export function canViewStateDepartment(roleKeys: string[]): boolean {
  return canViewCabinetHub(roleKeys);
}

export function canActAsSecretaryOfState(roleKeys: string[]): boolean {
  return canActAsPortfolioSecretary(roleKeys, "secretary_of_state");
}

export function canViewDefenseDepartment(roleKeys: string[]): boolean {
  return canViewCabinetHub(roleKeys);
}

export function canActAsSecretaryOfDefense(roleKeys: string[]): boolean {
  return canActAsPortfolioSecretary(roleKeys, "secretary_of_defense");
}

export function canViewHomelandDepartment(roleKeys: string[]): boolean {
  return canViewCabinetHub(roleKeys);
}

export function canActAsSecretaryOfHomeland(roleKeys: string[]): boolean {
  return canActAsPortfolioSecretary(roleKeys, "secretary_of_homeland_security");
}

export function canViewJusticeDepartment(roleKeys: string[]): boolean {
  return canViewCabinetHub(roleKeys);
}

export function canActAsAttorneyGeneral(roleKeys: string[]): boolean {
  return canActAsPortfolioSecretary(roleKeys, "attorney_general");
}

/** Chrome “Cabinet” link — same visibility as the hub. */
export function showCabinetNavForRoleKeys(roleKeys: string[]): boolean {
  return canViewCabinetHub(roleKeys);
}

// --- Back-compat names (older imports) ---
export const canAccessCabinetOverview = canViewCabinetHub;
export const canAccessTreasuryCabinet = canViewTreasuryDepartment;
export const canAccessStatePortfolio = canViewStateDepartment;
export const canAccessDefensePortfolio = canViewDefenseDepartment;
export const canAccessHomelandPortfolio = canViewHomelandDepartment;
export const canAccessJusticePortfolio = canViewJusticeDepartment;

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
    "Daily diplomatic hours, bilateral relationship scores, passive outreach, and intensive leader dialogues.",
  secretary_of_defense:
    "Readiness and exercises; escalation heat from State’s tracker and the Situation Room briefing for principals.",
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
