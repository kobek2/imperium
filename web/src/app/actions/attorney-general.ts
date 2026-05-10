"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { cabinetDayStartIso } from "@/lib/cabinet-week";
import {
  buildCourtAgenda,
  consequencesForAmicus,
  consequencesForArgument,
  consequencesForDecline,
  declineToDefendOutcome,
  isCourtAgenda,
  pickNextArchetype,
  presidentialOverridePenalty,
  scoreCourtAmicus,
  scoreCourtArgument,
  validateAmicusChoice,
  validateArgumentChoices,
} from "@/lib/court-case-agenda";
import type { CourtAgenda } from "@/lib/court-case-agenda";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";

// ---------- Auth helpers ----------

async function assertAttorneyGeneral(): Promise<{ userId: string; supabase: SupabaseClient }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const ok =
    roleKeys.includes("attorney_general") ||
    roleKeys.includes("admin") ||
    roleKeys.includes("staff_super");
  if (!ok) throw new Error("Only the Attorney General may take actions on the court docket.");

  return { userId: user.id, supabase };
}

async function assertPresidentOrAdmin(): Promise<{ userId: string; supabase: SupabaseClient }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const ok =
    roleKeys.includes("president") ||
    roleKeys.includes("admin") ||
    roleKeys.includes("staff_super");
  if (!ok) throw new Error("Only the President may issue a directive on a court case.");

  return { userId: user.id, supabase };
}

// ---------- Daily tick (called from page load + every action) ----------

const NEW_CASE_INTERVAL_HOURS = 48;
const MAX_OPEN_CASES = 2;
const RECENT_ARCHETYPE_LOOKBACK = 6;

async function expireStaleCases(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("rp_court_docket_daily_tick", {});
  if (error && !error.message.toLowerCase().includes("schema cache")) {
    console.warn("[courtDocketTick] expire:", error.message);
  }
}

async function maybeOpenNextCase(supabase: SupabaseClient): Promise<void> {
  const { data: openRows, error: openErr } = await supabase
    .from("rp_court_cases")
    .select("id, opens_at, archetype_key")
    .in("status", ["open", "argued"])
    .order("opens_at", { ascending: false });
  if (openErr) {
    if (openErr.message.toLowerCase().includes("schema cache")) return;
    console.warn("[courtDocketTick] open count:", openErr.message);
    return;
  }

  const open = openRows ?? [];
  if (open.length >= MAX_OPEN_CASES) return;

  const { data: recentRows, error: recentErr } = await supabase
    .from("rp_court_cases")
    .select("archetype_key, opens_at")
    .order("opens_at", { ascending: false })
    .limit(RECENT_ARCHETYPE_LOOKBACK);
  if (recentErr) {
    if (recentErr.message.toLowerCase().includes("schema cache")) return;
    console.warn("[courtDocketTick] recent:", recentErr.message);
    return;
  }
  const recent = (recentRows ?? []) as Array<{ archetype_key: string; opens_at: string }>;

  // Throttle: at least NEW_CASE_INTERVAL_HOURS between case openings.
  if (recent[0]) {
    const last = new Date(recent[0].opens_at).getTime();
    const elapsedHours = (Date.now() - last) / (1000 * 60 * 60);
    if (elapsedHours < NEW_CASE_INTERVAL_HOURS) return;
  }

  const recentKeys = recent.map((r) => r.archetype_key);
  const seed = `${cabinetDayStartIso()}:${recent.length}`;
  const archetypeKey = pickNextArchetype(recentKeys, seed);
  if (!archetypeKey) return;

  const agenda = buildCourtAgenda(archetypeKey, seed);
  if (!agenda) return;

  const { error } = await supabase.rpc("rp_court_open_case", {
    p_archetype_key: agenda.archetypeKey,
    p_case_label: agenda.caseLabel,
    p_topic: agenda.topic,
    p_fact_pattern: agenda.factPattern,
    p_question_presented: agenda.questionPresented,
    p_agenda: agenda as unknown as Record<string, unknown>,
    p_tilt_party: agenda.tiltParty,
    p_target_bill_id: null,
    p_lifetime_hours: 120,
  });
  if (error && !error.message.toLowerCase().includes("schema cache")) {
    console.warn("[courtDocketTick] open case:", error.message);
  }
}

/** Server-side tick: expire stale cases and open a new one if the cadence allows. */
export async function courtDocketTick(): Promise<void> {
  const supabase = await createClient();
  await expireStaleCases(supabase);
  await maybeOpenNextCase(supabase);
}

// ---------- Daily hours helper (mirror of cabinet-portfolios pattern) ----------

async function loadOrCreateDailyHours(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ id: string; hours_budget: number; hours_used: number }> {
  const dayUtc = cabinetDayStartIso();
  const { data: existing } = await supabase
    .from("cabinet_daily_hours")
    .select("id, hours_budget, hours_used")
    .eq("user_id", userId)
    .eq("role_key", "attorney_general")
    .eq("day_utc", dayUtc)
    .maybeSingle();

  if (existing) {
    return existing as { id: string; hours_budget: number; hours_used: number };
  }

  const { data: inserted, error } = await supabase
    .from("cabinet_daily_hours")
    .insert({ user_id: userId, role_key: "attorney_general", day_utc: dayUtc, hours_budget: 20, hours_used: 0 })
    .select("id, hours_budget, hours_used")
    .maybeSingle();

  if (error || !inserted) throw new Error(error?.message ?? "Could not start daily engagement budget.");
  return inserted as { id: string; hours_budget: number; hours_used: number };
}

async function burnHours(
  supabase: SupabaseClient,
  dayRow: { id: string; hours_used: number },
  hours: number,
): Promise<void> {
  const { error } = await supabase
    .from("cabinet_daily_hours")
    .update({ hours_used: Number(dayRow.hours_used) + hours })
    .eq("id", dayRow.id);
  if (error) throw new Error(error.message);
}

// ---------- Case loading ----------

type CaseRow = {
  id: string;
  status: string;
  agenda: unknown;
  side_taken: string | null;
  presidential_directive: string | null;
  target_bill_id: string | null;
  case_label: string;
  closes_at: string;
};

async function loadOpenCase(supabase: SupabaseClient, caseId: string): Promise<CaseRow> {
  const { data, error } = await supabase
    .from("rp_court_cases")
    .select("id, status, agenda, side_taken, presidential_directive, target_bill_id, case_label, closes_at")
    .eq("id", caseId)
    .maybeSingle();
  if (error || !data) throw new Error("Case not found.");
  const row = data as CaseRow;
  if (row.status !== "open") throw new Error("This case is no longer open.");
  if (!isCourtAgenda(row.agenda)) throw new Error("Case agenda is unreadable.");
  return row;
}

// ---------- Argument submission (defend / challenge) ----------

export async function agSubmitArgument(input: {
  caseId: string;
  side: "defend" | "challenge";
  choices: number[];
}): Promise<void> {
  const { userId, supabase } = await assertAttorneyGeneral();
  await expireStaleCases(supabase);

  if (input.side !== "defend" && input.side !== "challenge") throw new Error("Side must be defend or challenge.");

  const row = await loadOpenCase(supabase, input.caseId);
  const agenda = row.agenda as CourtAgenda;
  if (!validateArgumentChoices(agenda, input.choices)) throw new Error("Invalid argument choices.");

  const consequences = consequencesForArgument(input.side, "decisive_win"); // hours cost is constant per mode
  const dayRow = await loadOrCreateDailyHours(supabase, userId);
  const remaining = Number(dayRow.hours_budget) - Number(dayRow.hours_used);
  if (remaining < consequences.hoursCost) {
    throw new Error(`You need at least ${consequences.hoursCost}h remaining today to argue this case.`);
  }

  const score = scoreCourtArgument(agenda, input.side, input.choices, null);
  const out = consequencesForArgument(input.side, score.outcomeTier);

  // Apply directive override penalty if AG defied advisory directive.
  let confidenceDelta = out.publicConfidenceDelta;
  let outcomeSummary = score.summary;
  if (row.presidential_directive && row.presidential_directive !== input.side) {
    const pen = presidentialOverridePenalty();
    confidenceDelta += pen.publicConfidenceDelta;
    outcomeSummary +=
      ` The Attorney General argued against the President's advisory directive (${row.presidential_directive.toUpperCase()}); the public absorbed the inter-branch friction.`;
  }

  await burnHours(supabase, dayRow, out.hoursCost);

  const { error: closeErr } = await supabase.rpc("rp_court_close_case", {
    p_case_id: row.id,
    p_side_taken: input.side,
    p_choice_path: input.choices,
    p_outcome_tier: score.outcomeTier,
    p_outcome_summary: outcomeSummary,
    p_public_confidence_delta: confidenceDelta,
    p_metric_deltas: out.metricDeltas as unknown as Record<string, unknown>,
    p_strike_bill: out.strikeBill,
    p_status: "closed",
  });
  if (closeErr) throw new Error(closeErr.message);

  revalidatePath("/cabinet");
  revalidatePath("/cabinet/justice");
  revalidatePath(`/cabinet/justice/argue/${row.id}`);
}

// ---------- Amicus brief filing ----------

export async function agFileAmicus(input: { caseId: string; amicusIdx: number }): Promise<void> {
  const { userId, supabase } = await assertAttorneyGeneral();
  await expireStaleCases(supabase);

  const row = await loadOpenCase(supabase, input.caseId);
  const agenda = row.agenda as CourtAgenda;
  if (!validateAmicusChoice(agenda, input.amicusIdx)) throw new Error("Invalid amicus selection.");

  const score = scoreCourtAmicus(agenda, input.amicusIdx, null);
  const out = consequencesForAmicus(score.outcomeTier);

  const dayRow = await loadOrCreateDailyHours(supabase, userId);
  const remaining = Number(dayRow.hours_budget) - Number(dayRow.hours_used);
  if (remaining < out.hoursCost) {
    throw new Error(`You need at least ${out.hoursCost}h remaining today to file an amicus.`);
  }
  await burnHours(supabase, dayRow, out.hoursCost);

  const { error: closeErr } = await supabase.rpc("rp_court_close_case", {
    p_case_id: row.id,
    p_side_taken: "amicus",
    p_choice_path: [input.amicusIdx],
    p_outcome_tier: score.outcomeTier,
    p_outcome_summary: score.summary,
    p_public_confidence_delta: out.publicConfidenceDelta,
    p_metric_deltas: out.metricDeltas as unknown as Record<string, unknown>,
    p_strike_bill: false,
    p_status: "closed",
  });
  if (closeErr) throw new Error(closeErr.message);

  revalidatePath("/cabinet");
  revalidatePath("/cabinet/justice");
}

// ---------- Decline to defend ----------

export async function agDeclineToDefend(input: { caseId: string }): Promise<void> {
  const { userId, supabase } = await assertAttorneyGeneral();
  await expireStaleCases(supabase);

  const row = await loadOpenCase(supabase, input.caseId);
  const agenda = row.agenda as CourtAgenda;
  const declineOut = declineToDefendOutcome(agenda);
  const cons = consequencesForDecline();

  const dayRow = await loadOrCreateDailyHours(supabase, userId);
  const remaining = Number(dayRow.hours_budget) - Number(dayRow.hours_used);
  if (remaining < cons.hoursCost) {
    throw new Error(`You need at least ${cons.hoursCost}h remaining today to file a decline notice.`);
  }
  await burnHours(supabase, dayRow, cons.hoursCost);

  let confidenceDelta = cons.publicConfidenceDelta;
  let summary = declineOut.summary;
  if (row.presidential_directive === "defend") {
    const pen = presidentialOverridePenalty();
    confidenceDelta += pen.publicConfidenceDelta;
    summary +=
      ` The Attorney General declined to defend after the President's advisory directive to defend; public confidence absorbed the override.`;
  }

  const { error: closeErr } = await supabase.rpc("rp_court_close_case", {
    p_case_id: row.id,
    p_side_taken: "decline",
    p_choice_path: [],
    p_outcome_tier: declineOut.outcomeTier,
    p_outcome_summary: summary,
    p_public_confidence_delta: confidenceDelta,
    p_metric_deltas: cons.metricDeltas as unknown as Record<string, unknown>,
    p_strike_bill: cons.strikeBill,
    p_status: "closed",
  });
  if (closeErr) throw new Error(closeErr.message);

  revalidatePath("/cabinet");
  revalidatePath("/cabinet/justice");
}

// ---------- Form-action wrapper for the "Enter argument" button ----------

/** AG clicks "Argue this case" — burns nothing, just navigates to the multi-step argument screen. */
export async function startCourtArgument(formData: FormData): Promise<void> {
  await assertAttorneyGeneral();
  const caseId = String(formData.get("case_id") ?? "").trim();
  const side = String(formData.get("side") ?? "").trim();
  if (!caseId) throw new Error("Missing case id.");
  if (side !== "defend" && side !== "challenge") throw new Error("Side must be defend or challenge.");
  redirect(`/cabinet/justice/argue/${caseId}?side=${side}`);
}

// ---------- President directive (advisory) ----------

export async function presidentSetCourtDirective(formData: FormData): Promise<void> {
  const { supabase } = await assertPresidentOrAdmin();

  const caseId = String(formData.get("case_id") ?? "").trim();
  const directiveRaw = String(formData.get("directive") ?? "").trim();
  if (!caseId) throw new Error("Missing case id.");
  const directive: string | null =
    directiveRaw === "defend" || directiveRaw === "challenge" ? directiveRaw : null;

  const { error } = await supabase.rpc("rp_court_set_directive", {
    p_case_id: caseId,
    p_directive: directive,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/cabinet");
  revalidatePath("/cabinet/justice");
}
