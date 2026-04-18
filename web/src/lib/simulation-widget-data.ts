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
  const now = new Date();
  const { displaySettings, shouldPersistHealToDatabase } = healSimulationClockDrift(raw, now);

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

  return { ...raw, real_anchor_at: anchorIso };
}
