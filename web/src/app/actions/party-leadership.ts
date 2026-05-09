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
