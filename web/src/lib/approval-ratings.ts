import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchChamberMemberUserIds } from "@/lib/congress-composition";
import type { BillChamber } from "@/lib/bill-types";

const LEADER_ROLE: Record<BillChamber, string> = {
  house: "speaker",
  senate: "senate_majority_leader",
};

/**
 * Placeholder for future Discord floor-speech integration.
 * Do not call until speech events are modeled.
 */
export function applyFloorSpeechBonus(): void {
  // TODO: Discord webhook / speech sentiment → approval delta
}

export async function applyApprovalDelta(
  supabase: SupabaseClient,
  userId: string,
  delta: number,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("apply_profile_approval_delta", {
    p_user_id: userId,
    p_delta: delta,
    p_reason: reason,
  });
  if (error) console.warn("[applyApprovalDelta]", userId, error.message);
}

async function fetchLeaderVote(
  supabase: SupabaseClient,
  billId: string,
  chamber: BillChamber,
): Promise<{ leaderId: string | null; leaderParty: string | null; leaderVote: string | null }> {
  const roleKey = LEADER_ROLE[chamber];
  const [{ data: grants }, { data: profiles }] = await Promise.all([
    supabase.from("government_role_grants").select("user_id, role_key").eq("role_key", roleKey),
    supabase.from("profiles").select("id, office_role").eq("office_role", roleKey),
  ]);
  const ids = new Set<string>();
  for (const g of grants ?? []) ids.add(String((g as { user_id: string }).user_id));
  for (const p of profiles ?? []) ids.add(String((p as { id: string }).id));
  const leaderId = ids.size ? [...ids][0]! : null;
  if (!leaderId) return { leaderId: null, leaderParty: null, leaderVote: null };
  const { data: prof } = await supabase.from("profiles").select("party").eq("id", leaderId).maybeSingle();
  const { data: v } = await supabase
    .from("bill_votes")
    .select("vote")
    .eq("bill_id", billId)
    .eq("chamber", chamber)
    .eq("voter_id", leaderId)
    .maybeSingle();
  return {
    leaderId,
    leaderParty: (prof as { party?: string | null } | null)?.party ?? null,
    leaderVote: (v as { vote?: string } | null)?.vote ?? null,
  };
}

function normalizeParty(p: string | null | undefined): string | null {
  const s = (p ?? "").trim().toLowerCase();
  if (s === "democrat" || s === "republican" || s === "independent") return s;
  return null;
}

type WhipInstructionMap = Map<string, string>;

async function fetchWhipInstructions(
  supabase: SupabaseClient,
  billId: string,
  chamber: BillChamber,
): Promise<WhipInstructionMap> {
  const { data: rows } = await supabase
    .from("bill_whip_instructions")
    .select("party, instructed_vote")
    .eq("bill_id", billId)
    .eq("chamber", chamber);
  const map: WhipInstructionMap = new Map();
  for (const r of rows ?? []) {
    const party = normalizeParty(String((r as { party?: string }).party ?? ""));
    const vote = String((r as { instructed_vote?: string }).instructed_vote ?? "").toLowerCase();
    if (!party || (vote !== "yea" && vote !== "nay" && vote !== "present" && vote !== "abstain")) continue;
    map.set(party, vote);
  }
  return map;
}

/**
 * Called when a chamber floor vote closes. Idempotent per (bill, chamber) via RPC log.
 */
export async function processVoteApproval(
  supabase: SupabaseClient,
  billId: string,
  chamber: BillChamber,
  passed: boolean,
): Promise<void> {
  const { data: registered, error: regErr } = await supabase.rpc("register_vote_close_approval", {
    p_bill_id: billId,
    p_chamber: chamber,
  });
  if (regErr) {
    console.warn("[processVoteApproval] register:", regErr.message);
    return;
  }
  if (registered !== true) return;

  const { data: bill } = await supabase.from("bills").select("author_id").eq("id", billId).maybeSingle();
  const authorId = (bill as { author_id?: string } | null)?.author_id;

  const { data: voteRows } = await supabase
    .from("bill_votes")
    .select("voter_id, vote")
    .eq("bill_id", billId)
    .eq("chamber", chamber);

  const votes = (voteRows ?? []) as { voter_id: string; vote: string }[];
  const voterIds = new Set(votes.map((v) => v.voter_id));
  const { leaderParty, leaderVote } = await fetchLeaderVote(supabase, billId, chamber);
  const whipMap = await fetchWhipInstructions(supabase, billId, chamber);

  const winningVote = passed ? "yea" : "nay";

  for (const v of votes) {
    const { data: prof } = await supabase.from("profiles").select("party").eq("id", v.voter_id).maybeSingle();
    const party = normalizeParty((prof as { party?: string | null } | null)?.party ?? null);

    await applyApprovalDelta(supabase, v.voter_id, 1, `Cast a vote on bill (${chamber})`);

    if (v.vote === winningVote) {
      await applyApprovalDelta(supabase, v.voter_id, 1, `On the winning side of a floor vote (${chamber})`);
    }

    const expectedWhipVote = party ? whipMap.get(party) ?? null : null;
    if (expectedWhipVote) {
      if (v.vote === expectedWhipVote) {
        await applyApprovalDelta(supabase, v.voter_id, 2, "Voted in line with caucus whip guidance");
      } else {
        await applyApprovalDelta(supabase, v.voter_id, -3, "Voted against caucus whip guidance");
      }
    } else if (leaderVote && leaderParty && party === normalizeParty(leaderParty)) {
      if (v.vote === leaderVote && (v.vote === "yea" || v.vote === "nay")) {
        await applyApprovalDelta(supabase, v.voter_id, 2, "Voted with chamber majority leader");
      } else if ((v.vote === "yea" || v.vote === "nay") && v.vote !== leaderVote) {
        await applyApprovalDelta(supabase, v.voter_id, -3, "Voted against chamber majority leader");
      }
    }

    if (v.vote === "abstain" || v.vote === "present") {
      await applyApprovalDelta(supabase, v.voter_id, -1, "Abstained or voted present on a floor vote");
    }
  }

  const eligible = await fetchChamberMemberUserIds(supabase, chamber);
  for (const uid of eligible) {
    if (!voterIds.has(uid)) {
      await applyApprovalDelta(supabase, uid, -1, "Eligible but did not vote before the floor closed");
    }
  }

  if (!passed && authorId) {
    await applyApprovalDelta(supabase, authorId, -2, "Authored a bill that failed a floor vote");
  }
}

export async function processYearEndParticipationApproval(
  supabase: SupabaseClient,
  fiscalYearId?: string,
): Promise<{ adjustedMembers: number; fiscalYearId: string | null }> {
  const fyQuery = supabase
    .from("rp_fiscal_years")
    .select("id, started_at, closed_at")
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(1);
  const { data: fy } = fiscalYearId ? await supabase.from("rp_fiscal_years").select("id, started_at, closed_at").eq("id", fiscalYearId).maybeSingle() : await fyQuery.maybeSingle();
  if (!fy || !fy.started_at || !fy.closed_at) return { adjustedMembers: 0, fiscalYearId: null };

  const startIso = String(fy.started_at);
  const endIso = String(fy.closed_at);
  const [{ data: floorBills }, { data: authored }, { data: grants }, { data: profiles }] = await Promise.all([
    supabase
      .from("bills")
      .select("id")
      .in("status", ["law", "vetoed", "failed", "dead"])
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    supabase.from("bills").select("author_id, status").gte("created_at", startIso).lte("created_at", endIso),
    supabase.from("government_role_grants").select("user_id, role_key"),
    supabase.from("profiles").select("id, office_role"),
  ]);

  const billIds = new Set((floorBills ?? []).map((b) => String((b as { id: string }).id)));
  if (!billIds.size) return { adjustedMembers: 0, fiscalYearId: String((fy as { id: string }).id) };

  const { data: votes } = await supabase.from("bill_votes").select("bill_id, voter_id").in("bill_id", [...billIds]);

  const seatHolders = new Set<string>();
  for (const g of grants ?? []) {
    const k = String((g as { role_key: string }).role_key);
    if (k === "representative" || k === "senator") seatHolders.add(String((g as { user_id: string }).user_id));
  }
  for (const p of profiles ?? []) {
    const r = String((p as { office_role?: string | null }).office_role ?? "");
    if (r === "representative" || r === "senator") seatHolders.add(String((p as { id: string }).id));
  }

  const castCount = new Map<string, number>();
  for (const v of votes ?? []) {
    const billId = String((v as { bill_id: string }).bill_id);
    if (!billIds.has(billId)) continue;
    const uid = String((v as { voter_id: string }).voter_id);
    castCount.set(uid, (castCount.get(uid) ?? 0) + 1);
  }

  const authoredBy = new Map<string, { total: number; laws: number; failed: number }>();
  for (const b of authored ?? []) {
    const uid = String((b as { author_id?: string }).author_id ?? "");
    if (!uid) continue;
    const current = authoredBy.get(uid) ?? { total: 0, laws: 0, failed: 0 };
    current.total += 1;
    const status = String((b as { status?: string }).status ?? "");
    if (status === "law") current.laws += 1;
    if (status === "failed" || status === "dead" || status === "vetoed") current.failed += 1;
    authoredBy.set(uid, current);
  }

  let adjusted = 0;
  for (const uid of seatHolders) {
    const cast = castCount.get(uid) ?? 0;
    const turnout = cast / billIds.size;
    let delta = 0;
    if (turnout >= 0.9) delta += 4;
    else if (turnout >= 0.75) delta += 2;
    else if (turnout < 0.5) delta -= 3;
    else if (turnout < 0.65) delta -= 1;

    const authoredStats = authoredBy.get(uid) ?? { total: 0, laws: 0, failed: 0 };
    if (authoredStats.total > 0) delta += 1;
    delta += Math.min(4, authoredStats.laws * 2);
    delta -= Math.min(3, authoredStats.failed);

    if (delta !== 0) {
      await applyApprovalDelta(supabase, uid, delta, `Year-end participation review (FY ${String((fy as { id: string }).id).slice(0, 8)})`);
      adjusted += 1;
    }
  }

  return { adjustedMembers: adjusted, fiscalYearId: String((fy as { id: string }).id) };
}
