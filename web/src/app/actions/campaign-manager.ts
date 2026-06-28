"use server";

import { revalidatePath } from "next/cache";
import {
  beginAllCongressionalSeatFilings,
  beginPresidentDormantSeatFilings,
} from "@/app/actions/simulation";
import { getIsAdmin } from "@/lib/is-admin";
import {
  CAMPAIGN_MANAGER_RIVAL_STARTER_TREASURY,
  CAMPAIGN_MANAGER_STARTER_PAC_GRANT,
  type RivalDifficulty,
} from "@/lib/campaign-manager-config";
import { createClient } from "@/lib/supabase/server";
import { throwIfPostgrestError } from "@/lib/supabase-error";

export type CampaignActionResult = { ok: boolean; message: string };

function revalidateCampaignPaths() {
  for (const p of ["/campaign", "/congress", "/"]) revalidatePath(p);
}

export async function startLegislativeRound(): Promise<CampaignActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("campaign_start_legislative_round");
  if (error) return { ok: false, message: error.message };
  revalidateCampaignPaths();
  return { ok: true, message: "Legislative round started — nominate caucus leadership." };
}

export async function nominateLeadership(simId: string, role: string): Promise<CampaignActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("campaign_nominate_leadership", {
    p_sim_politician_id: simId,
    p_role: role,
  });
  if (error) return { ok: false, message: error.message };
  revalidateCampaignPaths();
  return { ok: true, message: `Nominated for ${role.replace(/_/g, " ")}.` };
}

export async function proposeRoundBill(input: {
  sponsorSimId: string;
  title: string;
  summary: string;
}): Promise<CampaignActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("campaign_propose_round_bill", {
    p_sponsor_sim: input.sponsorSimId,
    p_title: input.title.trim(),
    p_summary: input.summary.trim(),
  });
  if (error) return { ok: false, message: error.message };
  revalidateCampaignPaths();
  return { ok: true, message: "Bill proposed. Rival filed a counter-measure. Advance when ready." };
}

export async function setActiveRoundBill(billId: string): Promise<CampaignActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("campaign_set_active_round_bill", { p_bill_id: billId });
  if (error) return { ok: false, message: error.message };
  revalidateCampaignPaths();
  return { ok: true, message: "Active bill updated." };
}

export async function whipNpc(simId: string, vote: "yea" | "nay"): Promise<CampaignActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("campaign_whip_npc", {
    p_sim_politician_id: simId,
    p_vote: vote,
  });
  if (error) return { ok: false, message: error.message };
  revalidateCampaignPaths();
  return { ok: true, message: `Whipped vote: ${vote.toUpperCase()}.` };
}

export async function bribeNpc(
  simId: string,
  vote: "yea" | "nay",
  amount: number,
): Promise<CampaignActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("campaign_bribe_npc", {
    p_sim_politician_id: simId,
    p_vote: vote,
    p_amount: amount,
  });
  if (error) return { ok: false, message: error.message };
  revalidateCampaignPaths();
  revalidatePath("/economy/pac");
  return { ok: true, message: `Bribe filed — ${vote.toUpperCase()} (PAC −$${amount.toLocaleString()}).` };
}

export async function advanceLegislativeRound(): Promise<CampaignActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("campaign_advance_legislative_round");
  if (error) return { ok: false, message: error.message };
  const row = data as { phase?: string; result?: string; signed?: boolean } | null;
  revalidateCampaignPaths();
  const phase = row?.phase ?? "unknown";
  if (row?.result?.startsWith("failed")) {
    return { ok: true, message: `Bill failed (${row.result.replace(/_/g, " ")}). Round complete.` };
  }
  if (phase === "completed") {
    return {
      ok: true,
      message: row?.signed ? "Law signed! You gained political capital." : "Bill vetoed. Round complete.",
    };
  }
  return { ok: true, message: `Advanced to: ${phase.replace(/_/g, " ")}.` };
}

export async function enrollAsPartyStrategist(
  pacName?: string,
): Promise<CampaignActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in first." };

  const { data, error } = await supabase.rpc("campaign_manager_enroll_strategist", {
    p_pac_name: pacName?.trim() || null,
  });
  if (error) return { ok: false, message: error.message };

  const row = data as {
    starter_grant_applied?: boolean;
    treasury_balance?: number;
    pac_name?: string;
  } | null;

  revalidatePath("/campaign");
  revalidatePath("/economy/pac");
  revalidatePath("/");

  const grantNote =
    row?.starter_grant_applied === true
      ? ` Starter grant applied — treasury now $${Number(row.treasury_balance ?? 0).toLocaleString()}.`
      : "";

  return {
    ok: true,
    message: `You are now the party strategist.${grantNote} PAC: ${row?.pac_name ?? "registered"}.`,
  };
}

export async function bootCampaignManagerSeason(
  difficulty: RivalDifficulty = "normal",
): Promise<CampaignActionResult> {
  if (!(await getIsAdmin())) {
    return { ok: false, message: "Admin access required to boot a season." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("campaign_manager_boot_season", {
    p_human_party: "democrat",
    p_rival_party: "republican",
    p_starter_grant: CAMPAIGN_MANAGER_STARTER_PAC_GRANT,
    p_rival_treasury: CAMPAIGN_MANAGER_RIVAL_STARTER_TREASURY,
    p_difficulty: difficulty,
  });
  if (error) return { ok: false, message: error.message };
  void data;

  try {
    await beginAllCongressionalSeatFilings();
    await beginPresidentDormantSeatFilings();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Season flags set, but opening elections failed: ${msg}`,
    };
  }

  const paths = ["/campaign", "/elections", "/admin/elections", "/economy/pac", "/"];
  for (const p of paths) revalidatePath(p);

  return {
    ok: true,
    message:
      "Campaign Manager season booted: President + compact House/Senate races opened. Enroll on the War Room page to claim Democratic strategist and receive your starter PAC grant.",
  };
}

export async function fileStrategistBill(input: {
  title: string;
  contentMd: string;
  chamber: "house" | "senate";
}): Promise<CampaignActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in first." };

  const { data, error } = await supabase.rpc("campaign_manager_file_bill", {
    p_title: input.title.trim(),
    p_content_md: input.contentMd.trim(),
    p_chamber: input.chamber,
  });
  if (error) return { ok: false, message: error.message };

  const billId = (data as { bill_id?: string } | null)?.bill_id;
  revalidatePath("/campaign");
  revalidatePath("/congress");
  revalidatePath("/congress/house");
  revalidatePath("/congress/senate");
  if (billId) revalidatePath(`/bill/${billId}`);

  return {
    ok: true,
    message: billId
      ? `Bill filed to the ${input.chamber === "house" ? "House" : "Senate"} floor. The rival will whip against it.`
      : "Bill filed.",
  };
}

export async function disableRivalStrategist(): Promise<CampaignActionResult> {
  if (!(await getIsAdmin())) {
    return { ok: false, message: "Admin access required." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("simulation_settings")
    .update({ rival_strategist_enabled: false, updated_at: new Date().toISOString() })
    .eq("id", 1);
  throwIfPostgrestError(error);
  revalidatePath("/campaign");
  return { ok: true, message: "Rival strategist AI disabled — human Republican can take over." };
}
