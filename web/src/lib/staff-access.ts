import { redirect } from "next/navigation";
import { createClient, tryCreateClient } from "@/lib/supabase/server";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import {
  canOpenStaffPanel,
  hasAnyStaffPermission,
  hasFullStaffAccess,
  resolveStaffPermissions,
  type StaffPermission,
} from "@/lib/staff-permissions";

export type StaffAccess = {
  userId: string;
  roleKeys: string[];
  permissions: Set<StaffPermission>;
  /** `admin` or `staff_super` — all permissions, matches DB `is_staff_admin` after migration. */
  hasFullStaff: boolean;
  canAccessPanel: boolean;
};

/** Public elections UI extras (e.g. admin links) — elections or simulation staff, or full staff. */
export async function getStaffMayAccessElectionsConsole(): Promise<boolean> {
  const access = await getStaffAccess();
  if (!access) return false;
  if (access.hasFullStaff) return true;
  return access.permissions.has("elections") || access.permissions.has("simulation");
}

/** Party org admin tools on party pages. */
export async function getStaffMayManagePartyOrg(): Promise<boolean> {
  const access = await getStaffAccess();
  if (!access) return false;
  if (access.hasFullStaff) return true;
  return access.permissions.has("parties");
}

export async function getStaffAccess(): Promise<StaffAccess | null> {
  const supabase = await tryCreateClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const hasFullStaff = hasFullStaffAccess(roleKeys);
  const permissions = resolveStaffPermissions(roleKeys);
  const canAccessPanel = canOpenStaffPanel(roleKeys);

  return {
    userId: user.id,
    roleKeys,
    permissions,
    hasFullStaff,
    canAccessPanel,
  };
}

/** Throws if not authenticated; use for server actions that need the user. */
export async function getStaffAccessOrThrow(): Promise<StaffAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const hasFullStaff = hasFullStaffAccess(roleKeys);
  const permissions = resolveStaffPermissions(roleKeys);
  const canAccessPanel = canOpenStaffPanel(roleKeys);

  return {
    userId: user.id,
    roleKeys,
    permissions,
    hasFullStaff,
    canAccessPanel,
  };
}

export function requireStaffPermission(access: StaffAccess, permission: StaffPermission): void {
  if (access.hasFullStaff || access.permissions.has(permission)) return;
  throw new Error("You do not have permission for this action.");
}

export function requireAnyStaffPermission(
  access: StaffAccess,
  permissions: readonly StaffPermission[],
): void {
  if (access.hasFullStaff || hasAnyStaffPermission(access.roleKeys, permissions)) return;
  throw new Error("You do not have permission for this action.");
}

/** Server components: must be able to open /admin at all. */
export async function requireStaffPanelPage(): Promise<StaffAccess> {
  const access = await getStaffAccess();
  if (!access?.canAccessPanel) redirect("/");
  return access;
}

/** Server components: panel + one of the listed permissions (or full staff). */
export async function requireStaffPageAny(permissions: StaffPermission[]): Promise<StaffAccess> {
  const access = await requireStaffPanelPage();
  if (access.hasFullStaff) return access;
  if (permissions.some((p) => access.permissions.has(p))) return access;
  redirect("/admin/operations");
}

/** Server components: panel + exact permission (or full staff). */
export async function requireStaffPage(permission: StaffPermission): Promise<StaffAccess> {
  const access = await requireStaffPanelPage();
  if (access.hasFullStaff || access.permissions.has(permission)) return access;
  redirect("/admin/operations");
}
