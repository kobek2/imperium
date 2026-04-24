"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/is-admin";
import { throwIfPostgrestError } from "@/lib/supabase-error";

function assertPartyTreasuryKey(party: string): string | null {
  if (party === "democrat" || party === "republican") return party;
  return null;
}

function revalidatePartyPaths(partyKey: string) {
  revalidatePath("/economy");
  revalidatePath("/parties");
  revalidatePath(`/parties/${partyKey}`);
}

export async function adminStartPartyLeadershipFiling(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const party = String(formData.get("party_key") ?? "").trim();
  if (!assertPartyTreasuryKey(party)) {
    throw new Error("Invalid party.");
  }
  const { error } = await supabase.rpc("party_admin_start_party_leadership_filing", { p_party: party });
  throwIfPostgrestError(error);
  revalidatePartyPaths(party);
  revalidatePath("/admin");
  revalidatePath("/admin/party-leadership");
  revalidatePath("/admin/elections");
}

export async function declarePartyCandidacy(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const party = String(formData.get("party_key") ?? "").trim();
  const office = String(formData.get("office") ?? "").trim();
  if (!assertPartyTreasuryKey(party)) {
    throw new Error("Party officer elections are only for Democratic or Republican affiliates.");
  }
  const { error } = await supabase.rpc("party_declare_candidacy", { p_party: party, p_office: office });
  throwIfPostgrestError(error);
  revalidatePartyPaths(party);
}

/** Toggle vote like a primary: same candidate again removes your vote. */
export async function togglePartyOfficerVote(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const party = String(formData.get("party_key") ?? "").trim();
  const office = String(formData.get("office") ?? "").trim();
  const candidate = String(formData.get("candidate_id") ?? "").trim();
  if (!assertPartyTreasuryKey(party)) {
    throw new Error("Party votes are only for Democratic or Republican party rooms.");
  }
  const { error } = await supabase.rpc("party_cast_officer_vote", {
    p_party: party,
    p_office: office,
    p_candidate: candidate,
  });
  throwIfPostgrestError(error);
  revalidatePartyPaths(party);
}

export async function withdrawPartyOfficerCandidacy(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const party = String(formData.get("party_key") ?? "").trim();
  const office = String(formData.get("office") ?? "").trim();
  if (!assertPartyTreasuryKey(party)) {
    throw new Error("Invalid party.");
  }
  const { error } = await supabase.rpc("party_withdraw_officer_candidacy", { p_party: party, p_office: office });
  throwIfPostgrestError(error);
  revalidatePartyPaths(party);
}

export async function finalizePartyOfficerElection(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const { supabase } = await requireAdmin();
  const party = String(formData.get("party_key") ?? "").trim();
  const office = String(formData.get("office") ?? "").trim();
  if (!assertPartyTreasuryKey(party)) {
    return { ok: false, message: "Invalid party." };
  }
  const { data, error } = await supabase.rpc("party_finalize_officer_election", {
    p_party: party,
    p_office: office,
  });
  if (error) return { ok: false, message: error.message };
  const ok = Boolean((data as { ok?: boolean })?.ok);
  if (!ok) {
    return {
      ok: false,
      message: "No votes to tally for this office (or no clear winner). Add votes first, or wait for members to vote.",
    };
  }
  revalidatePartyPaths(party);
  revalidatePath(`/parties/${party}`, "page");
  revalidatePath("/admin/party-leadership");
  return { ok: true, message: "Officer term installed." };
}

export async function partyTransferTreasuryToMember(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const party = String(formData.get("party_key") ?? "").trim();
  const recipientId = String(formData.get("recipient_id") ?? "").trim();
  const amt = Number(String(formData.get("amount") ?? "").trim());
  if (!assertPartyTreasuryKey(party)) {
    return { ok: false, message: "Only Democratic and Republican parties use this treasury tool." };
  }
  if (!recipientId || !Number.isFinite(amt) || amt <= 0) {
    return { ok: false, message: "Choose a member and enter a valid amount." };
  }
  const { data, error } = await supabase.rpc("party_transfer_treasury_to_member", {
    p_party: party,
    p_recipient: recipientId,
    p_amount: amt,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePartyPaths(party);
  const paid = Number((data as { amount?: number })?.amount ?? amt);
  const treasuryAfter = Number((data as { treasury_after?: number })?.treasury_after ?? 0);
  return {
    ok: true,
    message: `Sent $${paid.toLocaleString(undefined, { maximumFractionDigits: 2 })} from the party treasury. Party balance is now $${treasuryAfter.toLocaleString(undefined, { maximumFractionDigits: 0 })}.`,
  };
}
