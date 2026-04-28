import type { SupabaseClient } from "@supabase/supabase-js";
import {
  healSimulationClockDrift,
  utcDayStart,
  type SimulationSettingsRow,
} from "@/lib/simulation-calendar";

/**
 * Resolves settings for UI widgets (corner badge, banners). When the DB anchor is badly drifted,
 * admins get an automatic `real_anchor_at = now()` write so the timeline self-corrects once.
 */
export async function resolveSimulationSettingsForWidget(
  supabase: SupabaseClient,
  raw: SimulationSettingsRow,
  isAdmin: boolean,
): Promise<SimulationSettingsRow> {
  // Keeps September budget-cycle pacing and fiscal windows in sync with the RP calendar.
  const { error: cycleErr } = await supabase.rpc("fiscal_sync_budget_cycle_with_simulation");
  if (cycleErr) {
    console.warn("[resolveSimulationSettingsForWidget] fiscal_sync_budget_cycle_with_simulation:", cycleErr.message);
  }

  const latestRowRes = await supabase.from("simulation_settings").select("*").eq("id", 1).maybeSingle();
  const effectiveRaw = (latestRowRes.data as SimulationSettingsRow | null) ?? raw;

  const now = new Date();
  const { displaySettings, shouldPersistHealToDatabase } = healSimulationClockDrift(effectiveRaw, now);

  if (!shouldPersistHealToDatabase || !isAdmin) {
    return displaySettings;
  }

  const anchorIso = utcDayStart(now).toISOString();
  const updatedAt = now.toISOString();
  const { error } = await supabase
    .from("simulation_settings")
    .update({ real_anchor_at: anchorIso, updated_at: updatedAt })
    .eq("id", 1);

  if (error) {
    console.warn("[resolveSimulationSettingsForWidget] persist heal failed:", error.message);
    return displaySettings;
  }

  return { ...effectiveRaw, real_anchor_at: anchorIso };
}
