import type { SupabaseClient } from "@supabase/supabase-js";
import { sumCampaignAdInventory, totalCampaignAdInventory } from "@/lib/campaign-ad-inventory";
import { formatPrimaryGovernmentTitle } from "@/lib/government-role-display";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";

export type HomeCareerStats = {
  primaryTitle: string;
  economyAvailable: boolean;
  walletBalance: number;
  politicalCapital: number;
  pacLevel: number | null;
  campaignAdUnits: number;
  electionsEntered: number;
  electionsActive: number;
  electionsWon: number;
  electionsLost: number;
  billsAuthored: number;
  billsSignedIntoLaw: number;
  billsDeadOrVetoed: number;
};

function missingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    msg.includes("schema cache") ||
    msg.includes("does not exist") ||
    msg.includes("could not find")
  );
}

function electionRow(
  row: unknown,
): { phase: string; winner_user_id: string | null } | null {
  const r = row as {
    elections?:
      | { phase: string; winner_user_id: string | null }
      | { phase: string; winner_user_id: string | null }[]
      | null;
  };
  const e = r.elections;
  if (!e) return null;
  return Array.isArray(e) ? e[0] ?? null : e;
}

/**
 * Aggregates economy, role, election, and bill stats for the signed-in home page.
 * Soft-fails per subsystem so older DBs without economy (etc.) do not break Home.
 */
export async function fetchHomeCareerStats(
  supabase: SupabaseClient,
  userId: string,
): Promise<HomeCareerStats> {
  const [
    profileRes,
    walletRes,
    pacRes,
    invRes,
    candRes,
    billsTotalRes,
    billsLawRes,
    billsFailRes,
  ] = await Promise.all([
    supabase.from("profiles").select("office_role, political_capital").eq("id", userId).maybeSingle(),
    supabase.from("economy_wallets").select("balance").eq("user_id", userId).maybeSingle(),
    supabase.from("economy_pacs").select("pac_name").eq("user_id", userId).maybeSingle(),
    supabase
      .from("economy_inventory")
      .select("sku, quantity")
      .eq("user_id", userId)
      .in("sku", ["campaign_ad_persuasion", "campaign_ad_attack", "campaign_ad"]),
    supabase
      .from("election_candidates")
      .select("election_id, elections ( phase, winner_user_id )")
      .eq("user_id", userId),
    supabase.from("bills").select("id", { count: "exact", head: true }).eq("author_id", userId),
    supabase.from("bills").select("id", { count: "exact", head: true }).eq("author_id", userId).eq("status", "law"),
    supabase
      .from("bills")
      .select("id", { count: "exact", head: true })
      .eq("author_id", userId)
      .in("status", ["dead", "vetoed"]),
  ]);

  let primaryTitle = "Citizen";
  if (!profileRes.error && profileRes.data) {
    try {
      const keys = await fetchEffectiveRoleKeys(supabase, userId, profileRes.data);
      primaryTitle = formatPrimaryGovernmentTitle(keys);
    } catch {
      primaryTitle = "Citizen";
    }
  }

  const economyAvailable = !walletRes.error && !missingTable(walletRes.error);
  const walletBalance = economyAvailable
    ? Number((walletRes.data as { balance?: number } | null)?.balance ?? 0)
    : 0;

  let pacLevel: number | null = null;
  if (!pacRes.error && pacRes.data) {
    pacLevel = 1;
  }

  let campaignAdUnits = 0;
  if (!invRes.error && invRes.data) {
    campaignAdUnits = totalCampaignAdInventory(
      sumCampaignAdInventory(invRes.data as Array<{ sku: string; quantity: number | null }>),
    );
  }

  let electionsEntered = 0;
  let electionsActive = 0;
  let electionsWon = 0;
  let electionsLost = 0;

  if (!candRes.error && candRes.data) {
    const rows = candRes.data as unknown[];
    electionsEntered = rows.length;
    for (const row of rows) {
      const e = electionRow(row);
      if (!e) continue;
      if (e.phase !== "closed") {
        electionsActive += 1;
        continue;
      }
      if (e.winner_user_id === userId) electionsWon += 1;
      else if (e.winner_user_id) electionsLost += 1;
    }
  }

  const billsAuthored = billsTotalRes.error ? 0 : billsTotalRes.count ?? 0;
  const billsSignedIntoLaw = billsLawRes.error ? 0 : billsLawRes.count ?? 0;
  const billsDeadOrVetoed = billsFailRes.error ? 0 : billsFailRes.count ?? 0;

  const politicalCapital = profileRes.error
    ? 0
    : Number((profileRes.data as { political_capital?: number } | null)?.political_capital ?? 0);

  return {
    primaryTitle,
    economyAvailable,
    walletBalance,
    politicalCapital,
    pacLevel,
    campaignAdUnits,
    electionsEntered,
    electionsActive,
    electionsWon,
    electionsLost,
    billsAuthored,
    billsSignedIntoLaw,
    billsDeadOrVetoed,
  };
}
