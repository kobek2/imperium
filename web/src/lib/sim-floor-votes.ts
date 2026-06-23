import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillChamber } from "@/lib/bill-types";

/** Cast roster votes for a bill (idempotent). */
export async function castSimPoliticianFloorVotes(
  supabase: SupabaseClient,
  billId: string,
): Promise<void> {
  const { error } = await supabase.rpc("cast_sim_politician_floor_votes", {
    p_bill_id: billId,
  });
  if (error) {
    console.warn("[sim-floor-votes] cast:", billId, error.message);
  }
}

export async function castActiveBillSimVotes(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("cast_active_bill_sim_votes");
  if (error) {
    console.warn("[sim-floor-votes] cast_active:", error.message);
  }
}

export async function tallyFloorYeasNaysAbstainWithSim(
  supabase: SupabaseClient,
  billId: string,
  chamber: BillChamber,
): Promise<{ yea: number; nay: number; abstain: number; cast: number }> {
  const [{ data: playerVotes }, { data: simVotes }] = await Promise.all([
    supabase.from("bill_votes").select("vote").eq("bill_id", billId).eq("chamber", chamber),
    supabase
      .from("bill_sim_votes")
      .select("vote")
      .eq("bill_id", billId)
      .eq("chamber", chamber),
  ]);

  let yea = 0;
  let nay = 0;
  let abstain = 0;
  for (const v of [...(playerVotes ?? []), ...(simVotes ?? [])]) {
    const vote = String((v as { vote: string }).vote ?? "");
    if (vote === "yea") yea += 1;
    else if (vote === "nay") nay += 1;
    else if (vote === "abstain") abstain += 1;
  }
  const cast = (playerVotes ?? []).length + (simVotes ?? []).length;
  return { yea, nay, abstain, cast };
}

export async function tallySenateYeasNaysWithSim(
  supabase: SupabaseClient,
  billId: string,
): Promise<{ yea: number; nay: number }> {
  const { yea, nay } = await tallyFloorYeasNaysAbstainWithSim(supabase, billId, "senate");
  return { yea, nay };
}

export async function tallyChamberPassWithSim(
  supabase: SupabaseClient,
  billId: string,
  chamber: BillChamber,
): Promise<boolean> {
  const { yea, nay } = await tallyFloorYeasNaysAbstainWithSim(supabase, billId, chamber);
  return yea > nay;
}
