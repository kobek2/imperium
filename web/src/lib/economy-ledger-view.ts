import type { SupabaseClient } from "@supabase/supabase-js";

export function ledgerRelatedUserId(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  const raw = d.to ?? d.from ?? d.from_officer ?? null;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export type EconomyLedgerDisplayRow = {
  id: string;
  wallet_user_id: string;
  delta: number;
  kind: string;
  detail: unknown;
  created_at: string;
  walletName: string;
  relatedName: string | null;
};

export async function fetchEconomyLedgerWithDisplayNames(
  supabase: SupabaseClient,
  limit: number,
): Promise<EconomyLedgerDisplayRow[]> {
  const { data: ledger, error } = await supabase
    .from("economy_ledger")
    .select("id, wallet_user_id, delta, kind, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) return [];

  const ledgerRows = (ledger ?? []) as Array<{
    id: string;
    wallet_user_id: string;
    delta: number;
    kind: string;
    detail: unknown;
    created_at: string;
  }>;

  const ledgerProfileIds = new Set<string>();
  for (const row of ledgerRows) {
    ledgerProfileIds.add(row.wallet_user_id);
    const related = ledgerRelatedUserId(row.detail);
    if (related) ledgerProfileIds.add(related);
  }

  const { data: ledgerProfiles } = ledgerProfileIds.size
    ? await supabase
        .from("profiles")
        .select("id, character_name, discord_username")
        .in("id", [...ledgerProfileIds])
    : { data: [] as Array<{ id: string; character_name: string | null; discord_username: string | null }> };

  const ledgerProfileById = new Map(
    (ledgerProfiles ?? []).map((p) => [
      p.id as string,
      ((p.character_name as string | null)?.trim() ||
        (p.discord_username as string | null)?.trim() ||
        (p.id as string).slice(0, 8)) as string,
    ]),
  );

  return ledgerRows.map((row) => {
    const relatedUserId = ledgerRelatedUserId(row.detail);
    return {
      ...row,
      walletName: ledgerProfileById.get(row.wallet_user_id) ?? row.wallet_user_id.slice(0, 8),
      relatedName: relatedUserId ? ledgerProfileById.get(relatedUserId) ?? relatedUserId.slice(0, 8) : null,
    };
  });
}
