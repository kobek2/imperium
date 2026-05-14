import type { SupabaseClient } from "@supabase/supabase-js";
import { computeSimulationRpInstant, defaultSimulationSettingsForDisplay, type SimulationSettingsRow } from "@/lib/simulation-calendar";
import { resolveSimulationSettingsForWidget } from "@/lib/simulation-widget-data";

/** RP January year of the first full sim Congress window (narrative ~119th). */
export const POLICY_CONGRESS_ANCHOR_RP_YEAR = 2032 as const;

/**
 * First RP year of the two-year congressional term containing `rp` (same value for both years of the term).
 * Anchor 2032: 2032–2033 → 2032; 2034–2035 → 2034; etc.
 */
export function policyCongressCycleStartRpYearFromInstant(rp: { year: number; month: number }): number {
  const y = rp.year;
  if (y <= POLICY_CONGRESS_ANCHOR_RP_YEAR) return POLICY_CONGRESS_ANCHOR_RP_YEAR;
  return POLICY_CONGRESS_ANCHOR_RP_YEAR + 2 * Math.floor((y - POLICY_CONGRESS_ANCHOR_RP_YEAR) / 2);
}

function englishOrdinal(n: number): string {
  const abs = Math.abs(n);
  const rem10 = abs % 10;
  const rem100 = abs % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

/** U.S.-style ordinal (119th, 120th, …) from the cycle start year. */
export function policyCongressOrdinalNumber(cycleStartYear: number): number {
  return 119 + (cycleStartYear - POLICY_CONGRESS_ANCHOR_RP_YEAR) / 2;
}

export function policyCongressOrdinalLabel(cycleStartYear: number): string {
  return `${englishOrdinal(policyCongressOrdinalNumber(cycleStartYear))} Congress`;
}

export async function resolvePolicyCongressCycleStartYear(
  supabase: SupabaseClient,
  params: { isAdminForHeal: boolean },
): Promise<number> {
  const { data: simRaw } = await supabase.from("simulation_settings").select("*").eq("id", 1).maybeSingle();
  const raw = (simRaw as SimulationSettingsRow | null) ?? defaultSimulationSettingsForDisplay();
  const effective = await resolveSimulationSettingsForWidget(supabase, raw, params.isAdminForHeal);
  const rp = computeSimulationRpInstant(effective, new Date());
  return policyCongressCycleStartRpYearFromInstant(rp);
}

/** Bills filed from a preset issue template ("Change Policy"), excluding appropriations rows. */
export async function countChangePolicyBillsInCongress(
  supabase: SupabaseClient,
  authorId: string,
  cycleStartYear: number,
): Promise<number> {
  const { data, error } = await supabase
    .from("bills")
    .select("id, policy_congress_cycle_start_year")
    .eq("author_id", authorId)
    .not("template_id", "is", null);

  if (error) {
    if (error.message.toLowerCase().includes("policy_congress_cycle_start_year")) {
      const { count, error: cErr } = await supabase
        .from("bills")
        .select("id", { count: "exact", head: true })
        .eq("author_id", authorId)
        .not("template_id", "is", null);
      if (cErr) throw new Error(cErr.message);
      return cycleStartYear === POLICY_CONGRESS_ANCHOR_RP_YEAR ? (count ?? 0) : 0;
    }
    throw new Error(error.message);
  }

  let n = 0;
  for (const row of data ?? []) {
    const y = (row as { policy_congress_cycle_start_year?: number | null }).policy_congress_cycle_start_year;
    const effective = y ?? POLICY_CONGRESS_ANCHOR_RP_YEAR;
    if (effective === cycleStartYear) n += 1;
  }
  return n;
}

export function canBypassChangePolicyBillLimit(roleKeys: string[]): boolean {
  return roleKeys.includes("admin") || roleKeys.includes("staff_super");
}

/** Server-side hint for filing UI: Change Policy tab when the member has used their one bill this Congress. */
export async function getChangePolicyFilingUiGate(
  supabase: SupabaseClient,
  params: { userId: string; roleKeys: string[] },
): Promise<{
  blocked: boolean;
  message: string | null;
  /** Set when `blocked` — e.g. "119th Congress" for overlay copy. */
  congressOrdinalLabel: string | null;
}> {
  if (canBypassChangePolicyBillLimit(params.roleKeys)) {
    return { blocked: false, message: null, congressOrdinalLabel: null };
  }
  try {
    const cycleStart = await resolvePolicyCongressCycleStartYear(supabase, {
      isAdminForHeal: params.roleKeys.includes("admin"),
    });
    const used = await countChangePolicyBillsInCongress(supabase, params.userId, cycleStart);
    if (used >= 1) {
      return {
        blocked: true,
        congressOrdinalLabel: policyCongressOrdinalLabel(cycleStart),
        message: `You can still file unlimited custom bills. Another Change Policy bill unlocks when the ${policyCongressOrdinalLabel(cycleStart + 2)} begins (simulation calendar).`,
      };
    }
  } catch (e) {
    console.warn("[getChangePolicyFilingUiGate]", e);
    return { blocked: false, message: null, congressOrdinalLabel: null };
  }
  return { blocked: false, message: null, congressOrdinalLabel: null };
}
