import type { SupabaseClient } from "@supabase/supabase-js";

/** Categories for obligating the federal budget defense line (matches DB check constraint). */
export const DEFENSE_PROCUREMENT_CATEGORIES = [
  "weapon_system_modernization",
  "heavy_armor",
  "cavalry_and_mobility",
  "aviation_rotary",
  "missiles_and_long_range_strike",
  "munitions_industrial_base",
] as const;

export type DefenseProcurementCategory = (typeof DEFENSE_PROCUREMENT_CATEGORIES)[number];

export const DEFENSE_PROCUREMENT_CATEGORY_LABELS: Record<DefenseProcurementCategory, string> = {
  weapon_system_modernization: "New gear & upgrades",
  heavy_armor: "Tanks & heavy vehicles",
  cavalry_and_mobility: "Cavalry & fast movers",
  aviation_rotary: "Helicopters & air lift",
  missiles_and_long_range_strike: "Missiles & long-range fires",
  munitions_industrial_base: "Ammo factories & stockpiles",
};

export function isDefenseProcurementCategory(v: string): v is DefenseProcurementCategory {
  return (DEFENSE_PROCUREMENT_CATEGORIES as readonly string[]).includes(v);
}

export function parseDefenseLineAllocated(lineItems: unknown): number {
  if (!Array.isArray(lineItems)) return 0;
  for (const row of lineItems) {
    const r = row as { key?: unknown; allocated?: unknown };
    if (String(r.key ?? "") === "defense") {
      const n = Number(r.allocated);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
  }
  return 0;
}

type DeptBody = Record<string, number>;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Nudge readiness / logistics after an obligation (scaled vs share of annual defense cap). */
export function applyDefenseProcurementMetricDeltas(
  category: DefenseProcurementCategory,
  amount: number,
  defenseCap: number,
  body: DeptBody,
): DeptBody {
  const readiness = Number(body.readiness ?? 50);
  const logistics = Number(body.logistics_stress ?? 40);
  const exercises = Number(body.alliance_exercises_completed ?? 0);
  const cap = Math.max(defenseCap, 1);
  const intensity = Math.min(1, (Number(amount) || 0) / (cap * 0.05));

  const bumpReadiness = (base: number) => clamp(readiness + base * intensity, 0, 100);
  const bumpLogistics = (delta: number) => clamp(logistics + delta * intensity, 0, 100);

  switch (category) {
    case "weapon_system_modernization":
      return {
        ...body,
        readiness: bumpReadiness(5),
        logistics_stress: bumpLogistics(0.5),
      };
    case "heavy_armor":
      return {
        ...body,
        readiness: bumpReadiness(3),
        logistics_stress: bumpLogistics(2),
      };
    case "cavalry_and_mobility":
      return {
        ...body,
        readiness: bumpReadiness(2.5),
        logistics_stress: bumpLogistics(1.5),
      };
    case "aviation_rotary":
      return {
        ...body,
        readiness: bumpReadiness(3.5),
        logistics_stress: bumpLogistics(1),
      };
    case "missiles_and_long_range_strike":
      return {
        ...body,
        readiness: bumpReadiness(4),
        logistics_stress: bumpLogistics(0.75),
      };
    case "munitions_industrial_base":
      return {
        ...body,
        readiness: bumpReadiness(2),
        logistics_stress: bumpLogistics(-1),
        alliance_exercises_completed: exercises + (intensity >= 0.35 ? 1 : 0),
      };
    default:
      return { ...body };
  }
}

export type DefenseProcurementRecentRow = {
  id: string;
  category: string;
  amount_obligated: number;
  memo: string;
  created_at: string;
};

export type DefenseProcurementOverview = {
  fiscalYearId: string;
  fiscalYearLabel: string;
  defenseCap: number;
  obligatedTotal: number;
  budgetSubmitted: boolean;
  recent: DefenseProcurementRecentRow[];
};

/** Active FY defense line + obligations (for Defense desk / NSC strip). */
export async function loadDefenseProcurementOverview(
  supabase: SupabaseClient,
  opts?: { recentLimit?: number },
): Promise<DefenseProcurementOverview | null> {
  const recentLimit = opts?.recentLimit ?? 12;
  const { data: fy, error: fyErr } = await supabase
    .from("rp_fiscal_years")
    .select("id, label, status")
    .eq("status", "active")
    .maybeSingle();
  if (fyErr || !fy) return null;

  const fyId = String((fy as { id: string }).id);
  const fyLabel = String((fy as { label: string }).label);

  const { data: budget, error: bErr } = await supabase
    .from("federal_budgets")
    .select("status, line_items")
    .eq("fiscal_year_id", fyId)
    .maybeSingle();
  if (bErr) return null;

  const budgetSubmitted = String((budget as { status?: string } | null)?.status ?? "") === "submitted";
  const defenseCap = parseDefenseLineAllocated((budget as { line_items?: unknown } | null)?.line_items);

  const { data: sumRows, error: o2Err } = await supabase
    .from("rp_defense_procurement_obligations")
    .select("amount_obligated")
    .eq("fiscal_year_id", fyId);
  if (o2Err) return null;

  let obligatedTotal = 0;
  for (const r of sumRows ?? []) {
    obligatedTotal += Number((r as { amount_obligated: number }).amount_obligated ?? 0);
  }

  const recent: DefenseProcurementRecentRow[] = [];
  if (recentLimit > 0) {
    const { data: obligationRows, error: o1Err } = await supabase
      .from("rp_defense_procurement_obligations")
      .select("id, category, amount_obligated, memo, created_at")
      .eq("fiscal_year_id", fyId)
      .order("created_at", { ascending: false })
      .limit(Math.max(0, recentLimit));
    if (o1Err) return null;

    for (const r of obligationRows ?? []) {
      const row = r as {
        id: string;
        category: string;
        amount_obligated: number;
        memo: string;
        created_at: string;
      };
      recent.push({
        id: row.id,
        category: row.category,
        amount_obligated: Number(row.amount_obligated),
        memo: row.memo ?? "",
        created_at: row.created_at,
      });
    }
  }

  return {
    fiscalYearId: fyId,
    fiscalYearLabel: fyLabel,
    defenseCap,
    obligatedTotal,
    budgetSubmitted,
    recent,
  };
}
