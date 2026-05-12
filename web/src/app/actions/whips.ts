"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import type { BillChamber } from "@/lib/bill-types";
import { throwIfPostgrestError } from "@/lib/supabase-error";

const HOUSE_WHIP_SET = new Set([
  "admin",
  "speaker",
  "house_majority_leader",
  "house_majority_whip",
  "house_minority_leader",
  "house_minority_whip",
]);
const SENATE_WHIP_SET = new Set([
  "admin",
  "senate_majority_leader",
  "senate_majority_whip",
  "senate_minority_leader",
  "senate_minority_whip",
]);
const PARTY_SET = new Set(["democrat", "republican", "independent"]);
const VOTE_SET = new Set(["yea", "nay"]);

function canSetWhip(roleKeys: string[], chamber: BillChamber): boolean {
  const set = chamber === "house" ? HOUSE_WHIP_SET : SENATE_WHIP_SET;
  return roleKeys.some((k) => set.has(k));
}

function chamberForWhipContext(status: string): BillChamber | null {
  if (status === "house_floor") return "house";
  if (status === "senate_floor") return "senate";
  return null;
}

export async function setBillWhipInstruction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const billId = String(formData.get("bill_id") ?? "").trim();
  const partyFromForm = String(formData.get("party") ?? "").trim().toLowerCase();
  const instructedVote = String(formData.get("instructed_vote") ?? "").trim().toLowerCase();
  if (!billId) throw new Error("Missing bill id.");
  if (!VOTE_SET.has(instructedVote)) throw new Error("Invalid vote instruction.");

  const { data: profile } = await supabase.from("profiles").select("office_role, party").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);

  const { data: bill } = await supabase
    .from("bills")
    .select("id, status, originating_chamber, title")
    .eq("id", billId)
    .maybeSingle();
  if (!bill) throw new Error("Bill not found.");

  const chamber = chamberForWhipContext(String(bill.status));
  if (!chamber) throw new Error("Whip instructions can only be set during an active floor vote.");
  if (!canSetWhip(roleKeys, chamber)) throw new Error("Only whips/leadership (or admin) may set vote instructions.");
  const actorParty = String((profile as { party?: string | null } | null)?.party ?? "").trim().toLowerCase();
  const party = PARTY_SET.has(actorParty) ? actorParty : partyFromForm;
  if (!PARTY_SET.has(party)) throw new Error("Set your party in your profile before sending whip guidance.");

  const { error } = await supabase.from("bill_whip_instructions").upsert(
    {
      bill_id: billId,
      chamber,
      party,
      instructed_vote: instructedVote,
      rationale: null,
      set_by: user.id,
      set_at: new Date().toISOString(),
    },
    { onConflict: "bill_id,chamber,party" },
  );
  throwIfPostgrestError(error);

  revalidatePath(`/bill/${billId}`);
  revalidatePath("/");
  revalidatePath("/congress");
}

