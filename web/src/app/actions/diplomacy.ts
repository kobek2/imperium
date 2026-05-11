"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { cabinetDayStartIso } from "@/lib/cabinet-week";
import {
  buildStoryScript,
  computeStoryRelationDelta,
  isStorySessionAgenda,
  validateStoryChoices,
} from "@/lib/diplomatic-story";
import type { DiplomaticStoryScript } from "@/lib/diplomatic-story";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";

async function assertSecretaryOfState(): Promise<{ userId: string; supabase: SupabaseClient }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const ok =
    roleKeys.includes("secretary_of_state") ||
    roleKeys.includes("admin") ||
    roleKeys.includes("staff_super");
  if (!ok) throw new Error("Only the Secretary of State may take diplomatic actions here.");

  return { userId: user.id, supabase };
}

async function diplomacyTick(supabase: SupabaseClient): Promise<void> {
  const today = cabinetDayStartIso();
  const { error } = await supabase.rpc("rp_diplomacy_daily_tick", { p_today: today });
  if (error && !error.message.toLowerCase().includes("schema cache")) {
    console.warn("[diplomacyTick]", error.message);
  }
}

async function loadOrCreateDailyHours(
  supabase: SupabaseClient,
  userId: string,
  roleKey: string,
): Promise<{ id: string; hours_budget: number; hours_used: number }> {
  const dayUtc = cabinetDayStartIso();
  const { data: existing } = await supabase
    .from("cabinet_daily_hours")
    .select("id, hours_budget, hours_used")
    .eq("user_id", userId)
    .eq("role_key", roleKey)
    .eq("day_utc", dayUtc)
    .maybeSingle();

  if (existing) {
    return existing as { id: string; hours_budget: number; hours_used: number };
  }

  const { data: inserted, error } = await supabase
    .from("cabinet_daily_hours")
    .insert({ user_id: userId, role_key: roleKey, day_utc: dayUtc, hours_budget: 20, hours_used: 0 })
    .select("id, hours_budget, hours_used")
    .maybeSingle();

  if (error || !inserted) throw new Error(error?.message ?? "Could not start daily engagement budget.");
  return inserted as { id: string; hours_budget: number; hours_used: number };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

async function maybeBroadcastCrisis(
  supabase: SupabaseClient,
  nationCode: string,
  nationName: string,
  prevRel: number,
  nextRel: number,
): Promise<void> {
  if (nextRel > 10 || prevRel <= 10) return;
  const day = cabinetDayStartIso();
  const { error } = await supabase.rpc("rp_diplomacy_broadcast_crisis_inbox", {
    p_nation_code: nationCode,
    p_nation_name: nationName,
    p_day: day,
  });
  if (error) console.warn("[maybeBroadcastCrisis]", error.message);
}

/**
 * Passive bilateral desk time — **not** tied to dialogue choices. Relationship bump is a fixed function of hours spent
 * (abstract “face time”): 2h→+2, 4h→+4, 6h→+7, 8h→+10 on the 0–100 scale (clamped).
 */
export async function stateSpendPassiveDiplomacy(formData: FormData): Promise<void> {
  const { userId, supabase } = await assertSecretaryOfState();
  await diplomacyTick(supabase);

  const nationCode = String(formData.get("nation_code") ?? "").trim().toUpperCase();
  const hours = Number(formData.get("hours") ?? 0);
  if (!nationCode) throw new Error("Pick a partner country.");
  if (![2, 4, 6, 8].includes(hours)) throw new Error("Hours must be 2, 4, 6, or 8.");

  const dayRow = await loadOrCreateDailyHours(supabase, userId, "secretary_of_state");
  const remaining = Number(dayRow.hours_budget) - Number(dayRow.hours_used);
  if (remaining < hours) throw new Error("Not enough hours left today.");

  const { data: nation, error: nErr } = await supabase
    .from("rp_foreign_nations")
    .select("code, name, us_relation")
    .eq("code", nationCode)
    .maybeSingle();
  if (nErr || !nation) throw new Error("Unknown country code.");

  const prevRel = Number((nation as { us_relation: number }).us_relation);
  const delta = hours === 2 ? 2 : hours === 4 ? 4 : hours === 6 ? 7 : 10;
  const nextRel = clamp(prevRel + delta, 0, 100);

  const { error: u1 } = await supabase
    .from("cabinet_daily_hours")
    .update({ hours_used: Number(dayRow.hours_used) + hours })
    .eq("id", dayRow.id);
  if (u1) throw new Error(u1.message);

  const { error: u2 } = await supabase
    .from("rp_foreign_nations")
    .update({ us_relation: nextRel, updated_at: new Date().toISOString() })
    .eq("code", nationCode);
  if (u2) throw new Error(u2.message);

  const nationName = String((nation as { name: string }).name);
  await maybeBroadcastCrisis(supabase, nationCode, nationName, prevRel, nextRel);

  const { error: logErr } = await supabase.from("rp_diplomatic_sessions").insert({
    user_id: userId,
    nation_code: nationCode,
    mode: "passive",
    status: "closed",
    agenda: { kind: "passive", hours, nationCode, label: "Bilateral desk block" },
    step_index: 0,
    choice_path: [],
    hours_committed: hours,
    outcome_rating: null,
    relation_delta: delta,
  });
  if (logErr) console.warn("[stateSpendPassiveDiplomacy] session log:", logErr.message);

  revalidatePath("/cabinet");
  revalidatePath("/cabinet/state");
  revalidatePath("/cabinet/nsc");
}

async function createOpenIntensiveStorySessionId(
  supabase: SupabaseClient,
  userId: string,
  nationCode: string,
  nationDisplayName: string,
): Promise<string> {
  await diplomacyTick(supabase);

  const code = nationCode.trim().toUpperCase();
  if (!code) throw new Error("Pick a partner country.");

  const { data: nation, error: nErr } = await supabase
    .from("rp_foreign_nations")
    .select("code")
    .eq("code", code)
    .maybeSingle();
  if (nErr || !nation) throw new Error("Unknown country code.");

  const dayRow = await loadOrCreateDailyHours(supabase, userId, "secretary_of_state");
  const remaining = Number(dayRow.hours_budget) - Number(dayRow.hours_used);
  if (remaining < 8) throw new Error("You need at least 8 hours remaining today to run an intensive dialogue.");

  const sessionId = randomUUID();
  const script = buildStoryScript(code, nationDisplayName, sessionId);

  const { error } = await supabase.from("rp_diplomatic_sessions").insert({
    id: sessionId,
    user_id: userId,
    nation_code: code,
    mode: "intensive",
    status: "open",
    agenda: script as unknown as Record<string, unknown>,
    step_index: 0,
    choice_path: [],
    hours_committed: 0,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/cabinet/state");
  return sessionId;
}

/** Creates an intensive story session and sends the Secretary to the dialogue screen. */
export async function startIntensiveDiplomacyDialogue(formData: FormData): Promise<void> {
  const { userId, supabase } = await assertSecretaryOfState();
  const nationCode = String(formData.get("nation_code") ?? "").trim().toUpperCase();
  if (!nationCode) throw new Error("Pick a partner country.");

  const { data: nation, error: nErr } = await supabase
    .from("rp_foreign_nations")
    .select("name")
    .eq("code", nationCode)
    .maybeSingle();
  if (nErr || !nation) throw new Error("Unknown country code.");
  const displayName = String((nation as { name: string }).name);

  const sessionId = await createOpenIntensiveStorySessionId(supabase, userId, nationCode, displayName);
  redirect(`/cabinet/state/dialogue/${sessionId}`);
}

/** Finalize story-mode intensive dialogue: consumes 8h, applies relationship delta from alignment only. */
export async function stateCompleteIntensiveDiplomacy(input: {
  sessionId: string;
  choice0: number;
  choice1: number;
  choice2: number;
}): Promise<void> {
  const { userId, supabase } = await assertSecretaryOfState();
  await diplomacyTick(supabase);

  const choicePath = [input.choice0, input.choice1, input.choice2];

  const { data: session, error: sErr } = await supabase
    .from("rp_diplomatic_sessions")
    .select("id, user_id, nation_code, status, agenda")
    .eq("id", input.sessionId)
    .maybeSingle();
  if (sErr || !session) throw new Error("Session not found.");
  const row = session as {
    user_id: string;
    nation_code: string;
    status: string;
    agenda: unknown;
  };
  if (row.user_id !== userId) throw new Error("Session belongs to another user.");
  if (row.status !== "open") throw new Error("This dialogue is already finished.");

  if (!isStorySessionAgenda(row.agenda)) {
    throw new Error("This session uses an older format and cannot be completed from the new dialogue screen.");
  }
  const script = row.agenda as DiplomaticStoryScript;
  if (!validateStoryChoices(script, choicePath)) throw new Error("Invalid conversation choices.");

  const hours = 8;
  const dayRow = await loadOrCreateDailyHours(supabase, userId, "secretary_of_state");
  const remaining = Number(dayRow.hours_budget) - Number(dayRow.hours_used);
  if (remaining < hours) throw new Error("Not enough hours left today for an intensive dialogue.");

  const { data: nation, error: nErr } = await supabase
    .from("rp_foreign_nations")
    .select("code, name, us_relation")
    .eq("code", row.nation_code)
    .maybeSingle();
  if (nErr || !nation) throw new Error("Nation row missing.");

  const prevRel = Number((nation as { us_relation: number }).us_relation);
  const { delta } = computeStoryRelationDelta(script, choicePath);
  const nextRel = clamp(prevRel + delta, 0, 100);

  const { error: u0 } = await supabase
    .from("cabinet_daily_hours")
    .update({ hours_used: Number(dayRow.hours_used) + hours })
    .eq("id", dayRow.id);
  if (u0) throw new Error(u0.message);

  const { error: u1 } = await supabase
    .from("rp_foreign_nations")
    .update({ us_relation: nextRel, updated_at: new Date().toISOString() })
    .eq("code", row.nation_code);
  if (u1) throw new Error(u1.message);

  const nationName = String((nation as { name: string }).name);
  await maybeBroadcastCrisis(supabase, row.nation_code, nationName, prevRel, nextRel);

  const { error: u2 } = await supabase
    .from("rp_diplomatic_sessions")
    .update({
      status: "closed",
      step_index: 3,
      choice_path: choicePath,
      hours_committed: hours,
      outcome_rating: null,
      relation_delta: delta,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.sessionId);
  if (u2) throw new Error(u2.message);

  revalidatePath("/cabinet");
  revalidatePath("/cabinet/state");
  revalidatePath("/cabinet/nsc");
  revalidatePath(`/cabinet/state/dialogue/${input.sessionId}`);
}
