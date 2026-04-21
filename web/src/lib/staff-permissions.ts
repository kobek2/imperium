/**
 * Staff panel permissions — stored in `government_role_grants.role_key` (and/or legacy `profiles.office_role`).
 *
 * - `admin` (legacy): full operator; treated as all permissions + DB superuser via `is_staff_admin`.
 * - `staff_super`: full staff panel + same DB access as admin (see migration `is_staff_admin`).
 * - `staff_*`: granular UI routes; DB policies still require `admin` or `staff_super` unless an RPC checks these keys.
 */

export const STAFF_GRANT_KEYS = {
  super: "staff_super",
  accounts: "staff_accounts",
  roles: "staff_roles",
  economy: "staff_economy",
  elections: "staff_elections",
  parties: "staff_parties",
  simulation: "staff_simulation",
} as const;

export type StaffPermission =
  | "accounts"
  | "roles"
  | "economy"
  | "elections"
  | "parties"
  | "simulation";

export const STAFF_PERMISSION_LABELS: Record<StaffPermission, string> = {
  accounts: "Accounts & directory",
  roles: "Character roles & grants",
  economy: "Economy & treasuries",
  elections: "Elections & races",
  parties: "Party leadership & org",
  simulation: "RP calendar & simulation",
};

/** Ordered for hub / docs. */
export const STAFF_PERMISSION_ORDER: StaffPermission[] = [
  "accounts",
  "roles",
  "economy",
  "elections",
  "parties",
  "simulation",
];

const KEY_TO_PERM: Record<string, StaffPermission> = {
  [STAFF_GRANT_KEYS.accounts]: "accounts",
  [STAFF_GRANT_KEYS.roles]: "roles",
  [STAFF_GRANT_KEYS.economy]: "economy",
  [STAFF_GRANT_KEYS.elections]: "elections",
  [STAFF_GRANT_KEYS.parties]: "parties",
  [STAFF_GRANT_KEYS.simulation]: "simulation",
};

/** True if this user has the legacy `admin` grant (not necessarily every staff_* key). */
export function hasAdminGrant(roleKeys: readonly string[]): boolean {
  return roleKeys.includes("admin");
}

/** Full staff: `admin` or `staff_super` — implied all {@link StaffPermission}s. */
export function hasFullStaffAccess(roleKeys: readonly string[]): boolean {
  return hasAdminGrant(roleKeys) || roleKeys.includes(STAFF_GRANT_KEYS.super);
}

export function resolveStaffPermissions(roleKeys: readonly string[]): Set<StaffPermission> {
  const out = new Set<StaffPermission>();
  if (hasFullStaffAccess(roleKeys)) {
    for (const p of STAFF_PERMISSION_ORDER) out.add(p);
    return out;
  }
  for (const k of roleKeys) {
    const p = KEY_TO_PERM[k];
    if (p) out.add(p);
  }
  return out;
}

export function hasStaffPermission(
  roleKeys: readonly string[],
  permission: StaffPermission,
): boolean {
  return resolveStaffPermissions(roleKeys).has(permission);
}

export function hasAnyStaffPermission(
  roleKeys: readonly string[],
  permissions: readonly StaffPermission[],
): boolean {
  const set = resolveStaffPermissions(roleKeys);
  return permissions.some((p) => set.has(p));
}

/** Any grant that can open the /admin shell (admin, staff_super, or any staff_*). */
export function canOpenStaffPanel(roleKeys: readonly string[]): boolean {
  if (hasFullStaffAccess(roleKeys)) return true;
  return roleKeys.some((k) => k.startsWith("staff_"));
}
