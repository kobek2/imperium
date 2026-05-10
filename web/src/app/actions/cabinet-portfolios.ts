"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { cabinetDayStartIso } from "@/lib/cabinet-week";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";

/** Only the portfolio secretary (or site operators) may mutate a department dashboard. */
async function assertPortfolioSecretary(requiredRole: string): Promise<{ userId: string; supabase: SupabaseClient }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const ok =
    roleKeys.includes(requiredRole) || roleKeys.includes("admin") || roleKeys.includes("staff_super");
  if (!ok) throw new Error("Only the Senate-confirmed portfolio secretary may take this action.");

  return { userId: user.id, supabase };
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

type DeptBody = Record<string, number>;

async function applyDepartmentPatch(
  supabase: SupabaseClient,
  portfolioKey: "defense" | "homeland" | "justice",
  patch: (body: DeptBody) => DeptBody,
): Promise<void> {
  const { data: row, error: rErr } = await supabase
    .from("rp_cabinet_department_metrics")
    .select("body")
    .eq("portfolio_key", portfolioKey)
    .maybeSingle();
  if (rErr || !row) throw new Error(rErr?.message ?? "Metrics row missing. Run latest migrations.");

  const body = { ...(row as { body: DeptBody }).body } as DeptBody;
  const next = patch(body);

  const { error: u } = await supabase
    .from("rp_cabinet_department_metrics")
    .update({ body: next, updated_at: new Date().toISOString() })
    .eq("portfolio_key", portfolioKey);
  if (u) throw new Error(u.message);
}

export async function defenseSpendHours(formData: FormData): Promise<void> {
  const action = String(formData.get("action") ?? "");
  const cost =
    action === "field_exercise" ? 5 : action === "acquisition_review" ? 4 : action === "personnel_surge" ? 6 : 0;
  if (!cost) throw new Error("Unknown action.");

  const { userId, supabase } = await assertPortfolioSecretary("secretary_of_defense");
  const dayRow = await loadOrCreateDailyHours(supabase, userId, "secretary_of_defense");
  const remaining = Number(dayRow.hours_budget) - Number(dayRow.hours_used);
  if (remaining < cost) throw new Error("Not enough hours left today.");

  await applyDepartmentPatch(supabase, "defense", (b) => {
    const readiness = Number(b.readiness ?? 50);
    const logistics = Number(b.logistics_stress ?? 40);
    const exercises = Number(b.alliance_exercises_completed ?? 0);
    if (action === "field_exercise") {
      return {
        ...b,
        readiness: clamp(readiness + 5, 0, 100),
        logistics_stress: clamp(logistics + 2, 0, 100),
        alliance_exercises_completed: exercises + 1,
      };
    }
    if (action === "acquisition_review") {
      return {
        ...b,
        readiness: clamp(readiness + 1, 0, 100),
        logistics_stress: clamp(logistics - 6, 0, 100),
      };
    }
    return {
      ...b,
      readiness: clamp(readiness + 3, 0, 100),
      logistics_stress: clamp(logistics - 4, 0, 100),
    };
  });

  const { error: u1 } = await supabase
    .from("cabinet_daily_hours")
    .update({ hours_used: Number(dayRow.hours_used) + cost })
    .eq("id", dayRow.id);
  if (u1) throw new Error(u1.message);

  revalidatePath("/cabinet");
  revalidatePath("/cabinet/defense");
}

export async function homelandSpendHours(formData: FormData): Promise<void> {
  const action = String(formData.get("action") ?? "");
  const cost =
    action === "national_coordination" ? 4 : action === "cyber_sprint" ? 5 : action === "border_surge" ? 6 : 0;
  if (!cost) throw new Error("Unknown action.");

  const { userId, supabase } = await assertPortfolioSecretary("secretary_of_homeland_security");
  const dayRow = await loadOrCreateDailyHours(supabase, userId, "secretary_of_homeland_security");
  const remaining = Number(dayRow.hours_budget) - Number(dayRow.hours_used);
  if (remaining < cost) throw new Error("Not enough hours left today.");

  await applyDepartmentPatch(supabase, "homeland", (b) => {
    const threat = Number(b.threat_index ?? 40);
    const border = Number(b.border_caseload ?? 1000);
    const cyber = Number(b.cyber_open_alerts ?? 5);
    if (action === "national_coordination") {
      return {
        ...b,
        threat_index: clamp(threat - 4, 0, 100),
        border_caseload: Math.max(0, border - 80),
      };
    }
    if (action === "cyber_sprint") {
      return {
        ...b,
        cyber_open_alerts: Math.max(0, cyber - 2),
        threat_index: clamp(threat - 1, 0, 100),
      };
    }
    return {
      ...b,
      border_caseload: Math.max(0, border - 200),
      threat_index: clamp(threat + 2, 0, 100),
    };
  });

  const { error: u1 } = await supabase
    .from("cabinet_daily_hours")
    .update({ hours_used: Number(dayRow.hours_used) + cost })
    .eq("id", dayRow.id);
  if (u1) throw new Error(u1.message);

  revalidatePath("/cabinet");
  revalidatePath("/cabinet/homeland-security");
}

export async function justiceSpendHours(formData: FormData): Promise<void> {
  const action = String(formData.get("action") ?? "");
  const cost =
    action === "prosecutorial_triage" ? 4 : action === "civil_rights_surge" ? 5 : action === "public_briefing" ? 3 : 0;
  if (!cost) throw new Error("Unknown action.");

  const { userId, supabase } = await assertPortfolioSecretary("attorney_general");
  const dayRow = await loadOrCreateDailyHours(supabase, userId, "attorney_general");
  const remaining = Number(dayRow.hours_budget) - Number(dayRow.hours_used);
  if (remaining < cost) throw new Error("Not enough hours left today.");

  await applyDepartmentPatch(supabase, "justice", (b) => {
    const inv = Number(b.active_investigations ?? 10);
    const civil = Number(b.civil_rights_queue ?? 6);
    const conf = Number(b.public_confidence ?? 50);
    if (action === "prosecutorial_triage") {
      return {
        ...b,
        active_investigations: Math.max(0, inv - 2),
        public_confidence: clamp(conf + 2, 0, 100),
      };
    }
    if (action === "civil_rights_surge") {
      return {
        ...b,
        civil_rights_queue: Math.max(0, civil - 3),
        public_confidence: clamp(conf + 1, 0, 100),
      };
    }
    return {
      ...b,
      public_confidence: clamp(conf + 5, 0, 100),
    };
  });

  const { error: u1 } = await supabase
    .from("cabinet_daily_hours")
    .update({ hours_used: Number(dayRow.hours_used) + cost })
    .eq("id", dayRow.id);
  if (u1) throw new Error(u1.message);

  revalidatePath("/cabinet");
  revalidatePath("/cabinet/justice");
}
