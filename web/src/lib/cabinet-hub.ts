import { CABINET_APPOINTMENT_ROLE_KEYS } from "@/config/cabinet-appointment-roles";
import { POLITICAL_ROLE_LABELS } from "@/config/political-roles";

/** Roles that may open the cabinet hub and treasury tools (matches app chrome “Cabinet” link). */
export function canAccessCabinetHub(roleKeys: string[]): boolean {
  return roleKeys.some(
    (k) =>
      k === "secretary_of_treasury" || k === "president" || k === "admin" || k === "staff_super",
  );
}

const DASHBOARD_HREF: Partial<Record<string, string>> = {
  secretary_of_treasury: "/cabinet/treasury",
};

const PORTFOLIO_BLURB: Partial<Record<string, string>> = {
  secretary_of_treasury:
    "Tax accounts, due warnings, daily penalties, and treasury tooling for the active fiscal year.",
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
