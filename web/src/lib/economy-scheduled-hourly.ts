import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Mirrors `public._economy_hourly_from_roles` (supabase/migrations economy_and_party_directory).
 * Keep in sync if server rates change.
 */
export function economyHourlyFromRoleKeys(roleKeys: readonly string[]): number {
  const keys = new Set(roleKeys);
  const hasRep = keys.has("representative");
  const hasSen = keys.has("senator");
  const hasSpk = keys.has("speaker");

  let hourly = 5000;
  if (hasRep) hourly = 142_000;
  else if (hasSen) hourly = 165_000;

  if (hasSpk) hourly += 90_000;
  if (keys.has("president")) hourly += 400_000;
  if (keys.has("vice_president")) hourly += 230_000;

  return hourly;
}

/** Mirrors `public._economy_pac_hourly`. */
export function economyPacHourly(level: number | null): number {
  if (level == null) return 0;
  switch (level) {
    case 1:
      return 300_000;
    case 2:
      return 500_000;
    case 3:
      return 1_000_000;
    default:
      return 0;
  }
}

/** Mirrors `public._economy_effective_role_keys` merge order (grants, then profile office_role). */
function effectiveRoleKeysForUser(
  userId: string,
  officeRole: string | null,
  grantsByUser: Map<string, string[]>,
): string[] {
  const keys: string[] = [...(grantsByUser.get(userId) ?? [])];
  const set = new Set(keys);
  if (officeRole && !set.has(officeRole)) {
    keys.push(officeRole);
  }
  return keys;
}

/**
 * Scheduled gross for one sim-hour collect (role + PAC), without the RPC.
 * PAC tiers only appear for `economy_pacs` rows visible to the caller under RLS (own row + staff auditors see all).
 * Prefer `fiscal_list_player_scheduled_hourly_gross` when deployed.
 */
export async function loadScheduledHourlyGrossWithoutRpc(supabase: SupabaseClient): Promise<number[]> {
  const [{ data: profiles, error: pe }, { data: grants, error: ge }, { data: pacs, error: ace }] = await Promise.all([
    supabase.from("profiles").select("id, office_role"),
    supabase.from("government_role_grants").select("user_id, role_key"),
    supabase.from("economy_pacs").select("user_id, level"),
  ]);
  if (pe) throw new Error(pe.message);
  if (ge) throw new Error(ge.message);
  if (ace) throw new Error(ace.message);

  const grantsByUser = new Map<string, string[]>();
  for (const row of grants ?? []) {
    const uid = String((row as { user_id: string }).user_id);
    const rk = String((row as { role_key: string }).role_key);
    const arr = grantsByUser.get(uid) ?? [];
    if (!arr.includes(rk)) arr.push(rk);
    grantsByUser.set(uid, arr);
  }

  const pacByUser = new Map<string, number | null>();
  for (const row of pacs ?? []) {
    const uid = String((row as { user_id: string }).user_id);
    const raw = (row as { level: number | null }).level;
    pacByUser.set(uid, raw == null || Number.isNaN(Number(raw)) ? null : Number(raw));
  }

  const out: number[] = [];
  for (const p of profiles ?? []) {
    const id = String((p as { id: string }).id);
    const officeRole = (p as { office_role: string | null }).office_role;
    const keys = effectiveRoleKeysForUser(id, officeRole, grantsByUser);
    const roleH = economyHourlyFromRoleKeys(keys);
    const lvl = pacByUser.get(id) ?? null;
    out.push(roleH + economyPacHourly(lvl));
  }
  return out;
}

export function isMissingPostgrestRpcError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const m = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    m.includes("could not find the function") ||
    m.includes("schema cache") ||
    m.includes("does not exist")
  );
}
