"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function assertPartyKey(party: string): string | null {
  if (party === "democrat" || party === "republican") return party;
  return null;
}

function revalidatePartyLeadership(partyKey: string) {
  revalidatePath(`/parties/${partyKey}`);
  revalidatePath(`/parties/${partyKey}/leadership`);
}

export async function partyNationalBoardAppoint(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const party = String(formData.get("party_key") ?? "").trim();
  const memberId = String(formData.get("member_id") ?? "").trim();
  if (!assertPartyKey(party)) return { ok: false, message: "Invalid party." };
  if (!memberId) return { ok: false, message: "Choose a member to appoint." };
  const { error } = await supabase.rpc("party_national_board_appoint", { p_party: party, p_member: memberId });
  if (error) return { ok: false, message: error.message };
  revalidatePartyLeadership(party);
  return { ok: true, message: "Board seat updated." };
}

export async function partyNationalBoardRemove(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const party = String(formData.get("party_key") ?? "").trim();
  const memberId = String(formData.get("member_id") ?? "").trim();
  if (!assertPartyKey(party)) return { ok: false, message: "Invalid party." };
  if (!memberId) return { ok: false, message: "Missing member." };
  const { error } = await supabase.rpc("party_national_board_remove", { p_party: party, p_member: memberId });
  if (error) return { ok: false, message: error.message };
  revalidatePartyLeadership(party);
  return { ok: true, message: "Member removed from the board." };
}

export async function partyRuleStartBoilerplateVote(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const party = String(formData.get("party_key") ?? "").trim();
  if (!assertPartyKey(party)) return { ok: false, message: "Invalid party." };
  const { error } = await supabase.rpc("party_rule_start_boilerplate_vote", { p_party: party });
  if (error) return { ok: false, message: error.message };
  revalidatePartyLeadership(party);
  return { ok: true, message: "Boilerplate ratification vote is open for the national board." };
}

export async function partyRuleProposeAmendment(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const party = String(formData.get("party_key") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const bodyMd = String(formData.get("body_md") ?? "").trim();
  if (!assertPartyKey(party)) return { ok: false, message: "Invalid party." };
  const { error } = await supabase.rpc("party_rule_propose_amendment", {
    p_party: party,
    p_title: title,
    p_body_md: bodyMd,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePartyLeadership(party);
  return { ok: true, message: "Amendment proposal is open for board vote." };
}

export async function partySetMemberCollectLevyRate(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const party = String(formData.get("party_key") ?? "").trim();
  const rateRaw = String(formData.get("member_collect_levy_rate") ?? "").trim();
  if (!assertPartyKey(party)) return { ok: false, message: "Invalid party." };
  const rate = Number(rateRaw);
  if (!Number.isFinite(rate) || rate < 0 || rate > 0.25) {
    return { ok: false, message: "Levy rate must be between 0 and 0.25 (25%)." };
  }
  const { error } = await supabase.rpc("party_set_member_collect_levy_rate", {
    p_party: party,
    p_rate: rate,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePartyLeadership(party);
  return { ok: true, message: "Member collect levy rate updated." };
}

export async function partyRuleCastVote(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const party = String(formData.get("party_key") ?? "").trim();
  const proposalId = String(formData.get("proposal_id") ?? "").trim();
  const yesRaw = String(formData.get("yes") ?? "").trim();
  const yes = yesRaw === "true" || yesRaw === "1";
  if (!assertPartyKey(party)) return { ok: false, message: "Invalid party." };
  if (!proposalId) return { ok: false, message: "Missing proposal." };
  const { error } = await supabase.rpc("party_rule_cast_vote", { p_proposal_id: proposalId, p_yes: yes });
  if (error) return { ok: false, message: error.message };
  revalidatePartyLeadership(party);
  return { ok: true, message: "Vote recorded." };
}
