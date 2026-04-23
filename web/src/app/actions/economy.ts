"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ECONOMY_MAX_OFFLINE_HOURS } from "@/lib/economy-config";

function assertPartyTreasuryKey(party: string): string | null {
  if (party === "democrat" || party === "republican") return party;
  return null;
}

function revalidateEconomy() {
  revalidatePath("/economy");
  revalidatePath("/economy/leaderboard");
  revalidatePath("/parties");
}

export async function collectEconomyIncome(): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("economy_collect_income", { p_body: {} });
  if (error) return { ok: false, message: error.message };
  const paid = Number((data as { paid?: number })?.paid ?? 0);
  const partyLevy = Number((data as { party_levy?: number })?.party_levy ?? 0);
  revalidateEconomy();
  const base =
    paid > 0
      ? `Collected $${paid.toLocaleString()} (up to ${ECONOMY_MAX_OFFLINE_HOURS}h).`
      : "Nothing to collect yet — the timer above shows when the next payout is available.";
  const partyNote =
    partyLevy > 0
      ? ` Party salary levy to treasury: $${partyLevy.toLocaleString(undefined, { maximumFractionDigits: 0 })} (withheld automatically).`
      : "";
  return {
    ok: true,
    message: base + partyNote,
  };
}

function normalizeDiscordUsernameInput(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("@")) s = s.slice(1).trim();
  const hash = s.indexOf("#");
  if (hash !== -1) s = s.slice(0, hash).trim();
  return s;
}

export async function transferToPlayer(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const raw = String(formData.get("recipient_discord_username") ?? "").trim();
  const amt = Number(String(formData.get("amount") ?? "").trim());
  const handle = normalizeDiscordUsernameInput(raw);
  if (!handle || !Number.isFinite(amt) || amt <= 0) {
    return { ok: false, message: "Enter the recipient's Discord username and a valid amount." };
  }
  if (/[%_]/.test(handle)) {
    return { ok: false, message: "Discord username cannot contain % or _." };
  }

  const { data: rows, error: qErr } = await supabase.from("profiles").select("id").ilike("discord_username", handle);
  if (qErr) return { ok: false, message: qErr.message };
  const ids = (rows ?? []) as Array<{ id: string }>;
  if (ids.length === 0) {
    return { ok: false, message: "No player found with that Discord username." };
  }
  if (ids.length > 1) {
    return { ok: false, message: "More than one profile matches that Discord username; ask an admin to disambiguate." };
  }
  const to = ids[0].id;
  if (to === user.id) return { ok: false, message: "You cannot transfer to yourself." };

  const { error } = await supabase.rpc("economy_transfer_to_user", { p_to_user: to, p_amount: amt });
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  return { ok: true, message: "Transfer complete." };
}

export async function depositPartyTreasury(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const { data: prof, error: pErr } = await supabase.from("profiles").select("party").eq("id", user.id).maybeSingle();
  if (pErr) return { ok: false, message: pErr.message };
  const aff = String((prof as { party?: string } | null)?.party ?? "").trim();
  if (aff !== "democrat" && aff !== "republican") {
    return { ok: false, message: "Only Democratic or Republican affiliates can deposit to a party treasury." };
  }

  const party = String(formData.get("party_key") ?? "").trim();
  const amt = Number(String(formData.get("amount") ?? "").trim());
  if (!party || !Number.isFinite(amt) || amt <= 0) return { ok: false, message: "Invalid party or amount." };
  if (party !== aff) {
    return { ok: false, message: "You can only deposit to your own party's treasury." };
  }
  if (!assertPartyTreasuryKey(party)) {
    return { ok: false, message: "Only Democratic and Republican parties maintain a pooled treasury." };
  }
  const { error } = await supabase.rpc("economy_party_deposit", { p_party: party, p_amount: amt });
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  return { ok: true, message: "Deposited to party treasury." };
}

export async function buyCampaignAds(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const qty = Math.max(1, Math.min(99, Math.floor(Number(String(formData.get("qty") ?? "1")))));
  const { error } = await supabase.rpc("economy_buy_campaign_ads", { p_qty: qty });
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  return { ok: true, message: `Purchased ${qty} ad(s).` };
}

export async function applyCampaignAdFromInventory(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const combined = String(formData.get("candidacy") ?? "").trim();
  const legacyE = String(formData.get("election_id") ?? "").trim();
  const legacyC = String(formData.get("candidate_id") ?? "").trim();
  let electionId = legacyE;
  let candidateId = legacyC;
  if (combined.includes("__")) {
    const parts = combined.split("__");
    electionId = (parts[0] ?? "").trim();
    candidateId = (parts[1] ?? "").trim();
  }
  if (!electionId || !candidateId) return { ok: false, message: "Missing election or candidate." };
  const { error } = await supabase.rpc("economy_use_campaign_ad", {
    p_election: electionId,
    p_candidate: candidateId,
  });
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  revalidatePath("/elections");
  revalidatePath(`/elections/${electionId}`);
  return { ok: true, message: `Applied +${1} campaign point.` };
}

export async function buyPac(): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("economy_buy_pac", {});
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  return { ok: true, message: "PAC registered at level 1." };
}

export async function upgradePac(): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("economy_upgrade_pac", {});
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  return { ok: true, message: "PAC upgraded." };
}

export type BlackjackTableState = {
  active: boolean;
  bet?: number;
  player_hand?: number[];
  player_value?: number;
  dealer_up?: number;
  dealer_hand?: number[];
  dealer_value?: number;
  dealer_hole_hidden?: boolean;
  outcome?: string;
  message?: string;
  balance?: number;
};

export async function blackjackTableState(): Promise<{ ok: boolean; state: BlackjackTableState; message?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("economy_blackjack_state");
  if (error) return { ok: false, state: { active: false }, message: error.message };
  return { ok: true, state: (data ?? { active: false }) as BlackjackTableState };
}

export async function blackjackStart(
  formData: FormData,
): Promise<{ ok: boolean; message: string; state?: BlackjackTableState }> {
  const supabase = await createClient();
  const bet = Number(String(formData.get("bet") ?? "").trim());
  if (!Number.isFinite(bet)) return { ok: false, message: "Invalid bet." };
  const { data, error } = await supabase.rpc("economy_blackjack_start", { p_bet: bet });
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  const state = data as BlackjackTableState;
  return { ok: true, message: state.message ?? "Round started.", state };
}

export async function blackjackAction(
  formData: FormData,
): Promise<{ ok: boolean; message: string; state?: BlackjackTableState }> {
  const supabase = await createClient();
  const action = String(formData.get("action") ?? "").trim().toLowerCase();
  if (action !== "hit" && action !== "stand") return { ok: false, message: "Invalid action." };
  const { data, error } = await supabase.rpc("economy_blackjack_action", { p_action: action });
  if (error) return { ok: false, message: error.message };
  revalidateEconomy();
  const state = data as BlackjackTableState;
  return { ok: true, message: state.message ?? "OK", state };
}
