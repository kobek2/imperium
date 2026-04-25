"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { receivingChamberForOrigination } from "@/lib/legislative-helpers";
import type { BillChamber } from "@/lib/bill-types";
import { throwIfPostgrestError } from "@/lib/supabase-error";

const HOUSE_WHIP_SET = new Set(["admin", "speaker", "house_majority_leader", "house_majority_whip", "house_minority_whip"]);
const SENATE_WHIP_SET = new Set(["admin", "senate_majority_leader", "senate_majority_whip", "senate_minority_whip"]);
const PARTY_SET = new Set(["democrat", "republican", "independent"]);
const VOTE_SET = new Set(["yea", "nay", "present", "abstain"]);

function canSetWhip(roleKeys: string[], chamber: BillChamber): boolean {
  const set = chamber === "house" ? HOUSE_WHIP_SET : SENATE_WHIP_SET;
  return roleKeys.some((k) => set.has(k));
}

function chamberForWhipContext(status: string, originating: BillChamber): BillChamber | null {
  if (status === "debate" || status === "house_floor" || status === "senate_floor" || status === "on_docket") {
    if (status === "senate_floor") return "senate";
    if (status === "house_floor") return "house";
    return originating;
  }
  if (status === "other_chamber_review" || status === "other_chamber_debate") {
    return receivingChamberForOrigination(originating);
  }
  return null;
}

export async function setBillWhipInstruction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const billId = String(formData.get("bill_id") ?? "").trim();
  const party = String(formData.get("party") ?? "").trim().toLowerCase();
  const instructedVote = String(formData.get("instructed_vote") ?? "").trim().toLowerCase();
  const rationale = String(formData.get("rationale") ?? "").trim();
  if (!billId) throw new Error("Missing bill id.");
  if (!PARTY_SET.has(party)) throw new Error("Invalid party.");
  if (!VOTE_SET.has(instructedVote)) throw new Error("Invalid vote instruction.");

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);

  const { data: bill } = await supabase
    .from("bills")
    .select("id, status, originating_chamber, title")
    .eq("id", billId)
    .maybeSingle();
  if (!bill) throw new Error("Bill not found.");

  const chamber = chamberForWhipContext(String(bill.status), bill.originating_chamber as BillChamber);
  if (!chamber) throw new Error("Whip instructions can only be set during docket, debate, or floor phases.");
  if (!canSetWhip(roleKeys, chamber)) throw new Error("Only whips/leadership (or admin) may set vote instructions.");

  const { error } = await supabase.from("bill_whip_instructions").upsert(
    {
      bill_id: billId,
      chamber,
      party,
      instructed_vote: instructedVote,
      rationale: rationale || null,
      set_by: user.id,
      set_at: new Date().toISOString(),
    },
    { onConflict: "bill_id,chamber,party" },
  );
  throwIfPostgrestError(error);

  const chamberRole = chamber === "house" ? "representative" : "senator";
  const { data: targets } = await supabase
    .from("profiles")
    .select("id")
    .eq("party", party)
    .eq("office_role", chamberRole);
  const dedupe = `whip:${billId}:${chamber}:${party}:${instructedVote}`;
  const inboxRows = (targets ?? []).map((t) => ({
    user_id: String((t as { id: string }).id),
    kind: "whip_instruction",
    title: `${chamber === "house" ? "House" : "Senate"} whip guidance`,
    body: `${String((bill as { title?: string }).title ?? "Bill")}: ${party} caucus instructed vote is ${instructedVote.toUpperCase()}.`,
    href: `/bill/${billId}`,
    dedupe_key: dedupe,
  }));
  if (inboxRows.length) {
    await supabase.from("inbox_items").insert(inboxRows).select("id");
  }

  revalidatePath(`/bill/${billId}`);
  revalidatePath("/");
  revalidatePath("/congress");
}

