"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/is-admin";
import { applyApprovalDelta, processYearEndParticipationApproval } from "@/lib/approval-ratings";

/**
 * Weekly-style inactivity penalty: members with a chamber seat who have not cast any bill vote
 * in the last 7 days receive −2 approval. Intended to be triggered by cron or staff.
 */
export async function processInactivityPenalty(): Promise<{ ok: boolean; message: string }> {
  const { supabase } = await requireAdmin();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: grants }, { data: profiles }, { data: recentVotes }] = await Promise.all([
    supabase.from("government_role_grants").select("user_id, role_key"),
    supabase.from("profiles").select("id, office_role"),
    supabase.from("bill_votes").select("voter_id").gte("created_at", weekAgo),
  ]);

  const activeVoters = new Set((recentVotes ?? []).map((v) => String((v as { voter_id: string }).voter_id)));
  const seatHolders = new Set<string>();
  for (const g of grants ?? []) {
    const k = String((g as { role_key: string }).role_key);
    if (k === "representative" || k === "senator") {
      seatHolders.add(String((g as { user_id: string }).user_id));
    }
  }
  for (const p of profiles ?? []) {
    const r = (p as { office_role: string | null }).office_role;
    if (r === "representative" || r === "senator") {
      seatHolders.add(String((p as { id: string }).id));
    }
  }

  let n = 0;
  for (const uid of seatHolders) {
    if (activeVoters.has(uid)) continue;
    await applyApprovalDelta(supabase, uid, -2, "No floor vote in 7+ days while Congress is in session");
    n++;
  }

  revalidatePath("/leaderboard");
  revalidatePath("/directory");
  return { ok: true, message: `Applied inactivity penalty to ${n} members (admin run).` };
}

/**
 * End-of-year approval balancing:
 * - vote participation rate across closed-year bills
 * - authored bills (+laws, -failed/vetoed/dead)
 */
export async function processYearEndApproval(
  fiscalYearId?: string,
): Promise<{ ok: boolean; message: string }> {
  const { supabase } = await requireAdmin();
  const result = await processYearEndParticipationApproval(supabase, fiscalYearId);
  revalidatePath("/leaderboard");
  revalidatePath("/directory");
  return {
    ok: true,
    message:
      result.fiscalYearId == null
        ? "No closed fiscal year found for year-end approval processing."
        : `Applied year-end approval balancing to ${result.adjustedMembers} members for fiscal year ${result.fiscalYearId}.`,
  };
}
