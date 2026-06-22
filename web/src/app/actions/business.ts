"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { PacCoordinationType } from "@/lib/pac-config";

function revalidateBusiness() {
  revalidatePath("/business");
  revalidatePath("/business/market");
  revalidatePath("/business/disclosures");
  revalidatePath("/business/investigations");
  revalidatePath("/economy");
}

export async function buyPac(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const name = String(formData.get("pac_name") ?? "").trim();
  if (name.length < 3) return { ok: false, message: "PAC name must be at least 3 characters." };
  const { error } = await supabase.rpc("economy_buy_pac", { p_name: name });
  if (error) return { ok: false, message: error.message };
  revalidateBusiness();
  return { ok: true, message: `PAC "${name}" registered at tier 1.` };
}

export async function upgradePac(): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("economy_upgrade_pac", {});
  if (error) return { ok: false, message: error.message };
  revalidateBusiness();
  return { ok: true, message: "PAC upgraded." };
}

export async function depositPacTreasury(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const amt = Number(String(formData.get("amount") ?? "").trim());
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, message: "Enter a valid amount." };
  const { error } = await supabase.rpc("pac_deposit_from_wallet", { p_amount: amt });
  if (error) return { ok: false, message: error.message };
  revalidateBusiness();
  return { ok: true, message: `Deposited $${amt.toLocaleString()} to PAC treasury.` };
}

export async function contributePacLegal(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const combined = String(formData.get("candidacy") ?? "").trim();
  const amt = Number(String(formData.get("amount") ?? "").trim());
  if (!combined.includes("__")) return { ok: false, message: "Select a candidate." };
  const [electionId, candidateId] = combined.split("__");
  if (!Number.isFinite(amt) || amt < 100_000) return { ok: false, message: "Minimum legal contribution is $100,000." };
  const { data, error } = await supabase.rpc("pac_contribute_legal", {
    p_election: electionId,
    p_candidate: candidateId,
    p_amount: amt,
  });
  if (error) return { ok: false, message: error.message };
  const pts = Number((data as { campaign_points?: number })?.campaign_points ?? 0);
  revalidateBusiness();
  revalidatePath("/elections");
  if (electionId) revalidatePath(`/elections/${electionId}`);
  return { ok: true, message: `Disclosed $${amt.toLocaleString()} → +${pts} campaign points (public record).` };
}

export async function contributePacIllegal(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const combined = String(formData.get("candidacy") ?? "").trim();
  const amt = Number(String(formData.get("amount") ?? "").trim());
  const coordination = String(formData.get("coordination_type") ?? "strategy").trim() as PacCoordinationType;
  if (!combined.includes("__")) return { ok: false, message: "Select a candidate." };
  const [electionId, candidateId] = combined.split("__");
  if (!Number.isFinite(amt) || amt < 100_000) return { ok: false, message: "Minimum contribution is $100,000." };
  const { data, error } = await supabase.rpc("pac_contribute_illegal", {
    p_election: electionId,
    p_candidate: candidateId,
    p_amount: amt,
    p_coordination_type: coordination,
  });
  if (error) return { ok: false, message: error.message };
  const payload = data as { campaign_points?: number; exposure_risk?: number; risk_added?: number };
  revalidateBusiness();
  revalidatePath("/elections");
  if (electionId) revalidatePath(`/elections/${electionId}`);
  return {
    ok: true,
    message: `Off-books coordination: +${payload.campaign_points ?? 0} points. Exposure risk now ${Math.round(payload.exposure_risk ?? 0)}% (+${Math.round(payload.risk_added ?? 0)}).`,
  };
}

export async function tradePacShares(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const industry = String(formData.get("industry_key") ?? "").trim();
  const side = String(formData.get("side") ?? "").trim();
  const shares = Number(String(formData.get("shares") ?? "").trim());
  if (!industry || (side !== "buy" && side !== "sell")) return { ok: false, message: "Invalid trade." };
  if (!Number.isFinite(shares) || shares <= 0) return { ok: false, message: "Enter share quantity." };
  const { error } = await supabase.rpc("pac_trade_shares", {
    p_industry_key: industry,
    p_shares: shares,
    p_side: side,
  });
  if (error) return { ok: false, message: error.message };
  revalidateBusiness();
  return { ok: true, message: `${side === "buy" ? "Bought" : "Sold"} ${shares} industry shares.` };
}

export async function buyPacMarketShares(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const pacId = String(formData.get("pac_id") ?? "").trim();
  const shares = Number(String(formData.get("shares") ?? "").trim());
  if (!pacId || !Number.isFinite(shares) || shares <= 0) return { ok: false, message: "Invalid order." };
  const { data, error } = await supabase.rpc("pac_market_buy", { p_pac_id: pacId, p_shares: shares });
  if (error) return { ok: false, message: error.message };
  const payload = data as { cost?: number; share_price?: number };
  revalidateBusiness();
  return {
    ok: true,
    message: `Bought ${shares} shares for $${Number(payload.cost ?? 0).toLocaleString()}. New price: $${Number(payload.share_price ?? 0).toLocaleString()}/sh.`,
  };
}

export async function sellPacMarketShares(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const pacId = String(formData.get("pac_id") ?? "").trim();
  const shares = Number(String(formData.get("shares") ?? "").trim());
  if (!pacId || !Number.isFinite(shares) || shares <= 0) return { ok: false, message: "Invalid order." };
  const { data, error } = await supabase.rpc("pac_market_sell", { p_pac_id: pacId, p_shares: shares });
  if (error) return { ok: false, message: error.message };
  const payload = data as { proceeds?: number; share_price?: number };
  revalidateBusiness();
  return {
    ok: true,
    message: `Sold ${shares} shares for $${Number(payload.proceeds ?? 0).toLocaleString()}. New price: $${Number(payload.share_price ?? 0).toLocaleString()}/sh.`,
  };
}

export async function investigatePlayer(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const targetUserId = String(formData.get("target_user_id") ?? "").trim();
  const electionId = String(formData.get("election_id") ?? "").trim() || null;
  const pacId = String(formData.get("pac_id") ?? "").trim() || null;
  if (!targetUserId) return { ok: false, message: "Select an investigation target." };
  const { data, error } = await supabase.rpc("pac_investigate_player", {
    p_target_user: targetUserId,
    p_election_id: electionId,
    p_pac_id: pacId,
  });
  if (error) return { ok: false, message: error.message };
  const payload = data as { success?: boolean; message?: string; summary?: string };
  revalidateBusiness();
  if (payload.success) {
    return { ok: true, message: `Exposure: ${payload.summary ?? "Corruption uncovered."}` };
  }
  return { ok: true, message: payload.message ?? "Investigation found nothing actionable." };
}
