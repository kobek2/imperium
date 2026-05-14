"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { cabinetDayStartIso } from "@/lib/cabinet-week";
import {
  applyDefenseProcurementMetricDeltas,
  isDefenseProcurementCategory,
} from "@/lib/defense-procurement-budget";
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

/**
 * Obligate defense line appropriations toward modernization / platforms (capped by active FY federal budget).
 * Does not move treasury cash — RP obligation ledger vs the defense `allocated` line item.
 */
export async function defenseObligateProcurement(formData: FormData): Promise<void> {
  const { supabase } = await assertPortfolioSecretary("secretary_of_defense");

  const { data: fy } = await supabase.from("rp_fiscal_years").select("id").eq("status", "active").maybeSingle();
  if (!fy) throw new Error("No active fiscal year.");

  const fiscalYearId = String((fy as { id: string }).id);

  const category = String(formData.get("category") ?? "").trim();
  if (!isDefenseProcurementCategory(category)) throw new Error("Pick a procurement category.");

  const quickRaw = String(formData.get("quick_amount") ?? "").trim().replace(/,/g, "");
  const typedRaw = String(formData.get("amount_obligated") ?? "").replace(/,/g, "");
  const amountRaw = Number(quickRaw || typedRaw);
  if (!Number.isFinite(amountRaw) || amountRaw <= 0) throw new Error("Enter an amount or pick a quick spend.");
  const amount = Math.round(amountRaw * 100) / 100;

  const memo = String(formData.get("memo") ?? "").trim();

  const { data: rpcJson, error: rpcErr } = await supabase.rpc("rp_defense_obligate_procurement", {
    p_fiscal_year_id: fiscalYearId,
    p_category: category,
    p_amount: amount,
    p_memo: memo,
  });

  if (rpcErr) {
    const m = rpcErr.message ?? "";
    if (m.includes("INSUFFICIENT_DEFENSE_APPROPRIATION")) {
      throw new Error("That obligation exceeds remaining defense appropriations for this fiscal year.");
    }
    throw new Error(m || "Could not record procurement obligation.");
  }

  const cap = Number((rpcJson as { defense_line_cap?: unknown } | null)?.defense_line_cap ?? 0);
  if (cap > 0) {
    await applyDepartmentPatch(supabase, "defense", (b) =>
      applyDefenseProcurementMetricDeltas(category, amount, cap, b),
    );
  }

  revalidatePath("/cabinet");
  revalidatePath("/cabinet/defense");
  revalidatePath("/cabinet/nsc");
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
