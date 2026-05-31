"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/is-admin";
import { getStaffAccess } from "@/lib/staff-access";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { hasFullStaffAccess } from "@/lib/staff-permissions";
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

async function requireStaffAdminSupabase() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const keys = await fetchEffectiveRoleKeys(supabase, user.id, profile ?? null);
  if (!hasFullStaffAccess(keys)) {
    throw new Error("Only full staff (admin or staff_super) may appoint party officers.");
  }
  return { supabase };
}

async function requirePartyConsoleSupabase() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const access = await getStaffAccess();
  if (!access?.canAccessPanel) throw new Error("Forbidden");
  if (!access.hasFullStaff && !access.permissions.has("parties")) {
    throw new Error("Forbidden");
  }
  return { supabase };
}

function sanitizeIlikeFragment(q: string): string {
  return q.replace(/\\/g, "").replace(/%/g, "").replace(/_/g, "").trim();
}

export type PartyMemberSearchHit = {
  id: string;
  character_name: string;
  discord_username: string | null;
  residence_state: string | null;
  home_district_code: string | null;
};

export async function searchPartyAffiliateProfiles(
  partyKey: string,
  query: string,
): Promise<PartyMemberSearchHit[]> {
  const pk = assertPartyTreasuryKey(partyKey.trim());
  if (!pk) throw new Error("Invalid party.");
  const { supabase } = await requirePartyConsoleSupabase();
  const s = sanitizeIlikeFragment(query);
  if (s.length < 2) return [];
  const pattern = `%${s}%`;
  const [{ data: byName, error: e1 }, { data: byDiscord, error: e2 }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, character_name, discord_username, residence_state, home_district_code")
      .eq("party", pk)
      .ilike("character_name", pattern)
      .order("character_name", { ascending: true })
      .limit(20),
    supabase
      .from("profiles")
      .select("id, character_name, discord_username, residence_state, home_district_code")
      .eq("party", pk)
      .ilike("discord_username", pattern)
      .order("character_name", { ascending: true })
      .limit(20),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  const byId = new Map<string, PartyMemberSearchHit>();
  for (const r of [...(byName ?? []), ...(byDiscord ?? [])]) {
    const row = r as PartyMemberSearchHit;
    byId.set(row.id, row);
  }
  return [...byId.values()]
    .sort((a, b) => a.character_name.localeCompare(b.character_name))
    .slice(0, 20);
}

const PARTY_OFFICER_OFFICES = ["chair", "vice_chair", "treasurer"] as const;
export type PartyOfficerOffice = (typeof PARTY_OFFICER_OFFICES)[number];

export async function adminAppointPartyOfficer(input: {
  partyKey: string;
  office: string;
  userId: string;
}): Promise<void> {
  const pk = assertPartyTreasuryKey(input.partyKey.trim());
  if (!pk) throw new Error("Invalid party.");
  const office = input.office.trim();
  if (!(PARTY_OFFICER_OFFICES as readonly string[]).includes(office)) {
    throw new Error("Office must be chair, vice_chair, or treasurer.");
  }
  const { supabase } = await requireStaffAdminSupabase();
  const { error } = await supabase.rpc("admin_appoint_party_officer", {
    p_party: pk,
    p_office: office,
    p_user_id: input.userId,
  });
  if (error) throw new Error(error.message);
  revalidatePartyPaths(pk);
  revalidatePath("/admin/elections");
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
  revalidatePath("/admin/elections");
  revalidatePath("/admin/leadership-elections");
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
