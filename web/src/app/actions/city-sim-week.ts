"use server";

import { revalidatePath } from "next/cache";
import { NYC_CITY_CODE } from "@/lib/city";
import { mapCitySimWeekStatus } from "@/lib/city-sim-week-data";
import { cyclePhaseLabel, formatCitySimWeek, type CityCyclePhase } from "@/lib/city-sim-week";
import { createClient, getServerAuth } from "@/lib/supabase/server";

export type AdvanceCitySimWeekResult = {
  ok: boolean;
  message: string;
  simYear?: number;
  simWeek?: number;
  simTick?: number;
  warnings?: string[];
};

function revalidateSimPaths() {
  for (const p of [
    "/admin/elections",
    "/council",
    "/mayor",
    "/",
    "/elections",
    "/imperium",
    "/directory",
  ]) {
    revalidatePath(p);
  }
}

async function requireStaffOperator() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) throw new Error("Unauthorized");

  const { data: isStaff, error } = await supabase.rpc("is_staff_admin", { uid: user.id });
  if (error) throw new Error(error.message);
  if (!isStaff) throw new Error("Staff operator only");

  return { supabase, user };
}

function resultFromTick(
  data: Record<string, unknown> | null,
  prefix: string,
): AdvanceCitySimWeekResult {
  const status = mapCitySimWeekStatus(data);
  return {
    ok: true,
    message: `${prefix}: ${formatCitySimWeek(status)} · ${cyclePhaseLabel(status.cyclePhase)}`,
    simYear: status.simYear,
    simWeek: status.simWeek,
    simTick: status.simTick,
  };
}

/** Advance to the next biennium cycle phase (sign-ups → primaries → generals → legislative). */
export async function advanceCityCyclePhaseAction(): Promise<AdvanceCitySimWeekResult> {
  const { supabase } = await requireStaffOperator();
  const { data, error } = await supabase.rpc("admin_advance_city_cycle_phase", {
    p_city_code: NYC_CITY_CODE,
  });
  if (error) return { ok: false, message: error.message };

  revalidateSimPaths();
  return resultFromTick(data as Record<string, unknown> | null, "Advanced cycle phase");
}

/** Jump directly to a cycle phase within the current biennium (or next biennium for sign-ups from legislative). */
export async function jumpCityCyclePhaseAction(phase: CityCyclePhase): Promise<AdvanceCitySimWeekResult> {
  const { supabase } = await requireStaffOperator();
  const { data, error } = await supabase.rpc("admin_jump_city_cycle_phase", {
    p_city_code: NYC_CITY_CODE,
    p_phase: phase,
  });
  if (error) return { ok: false, message: error.message };

  revalidateSimPaths();
  return resultFromTick(data as Record<string, unknown> | null, `Jumped to ${cyclePhaseLabel(phase)}`);
}

/** Create mayor + active-class council races for the current sim year if missing. */
export async function openCityElectionsNowAction(): Promise<AdvanceCitySimWeekResult> {
  const { supabase } = await requireStaffOperator();
  const { data, error } = await supabase.rpc("admin_open_city_elections_now", {
    p_city_code: NYC_CITY_CODE,
  });
  if (error) return { ok: false, message: error.message };

  revalidateSimPaths();
  const row = data as { created?: number; class_b_created?: number } | null;
  return {
    ok: true,
    message: `Opened city elections (${row?.created ?? 0} Class A/mayor, ${row?.class_b_created ?? 0} Class B)`,
  };
}

/** Smart election advance: Wave 1 → Wave 2 → next biennium Wave 1. */
export async function advanceCityElectionWaveAction(): Promise<AdvanceCitySimWeekResult> {
  const { supabase } = await requireStaffOperator();
  const { data, error } = await supabase.rpc("admin_advance_city_election_wave", {
    p_city_code: NYC_CITY_CODE,
  });
  if (error) return { ok: false, message: error.message };

  revalidateSimPaths();
  const row = data as { message?: string; sim_year?: number; biennium?: number; wave?: number } | null;
  return {
    ok: true,
    message: row?.message ?? "Election wave advanced.",
    simYear: row?.sim_year,
  };
}

/** Create Class B council races (districts W05–W07) for the even sim year in this biennium. */
export async function openClassBElectionsNowAction(): Promise<AdvanceCitySimWeekResult> {
  const { supabase } = await requireStaffOperator();
  const { data, error } = await supabase.rpc("admin_open_class_b_elections_now", {
    p_city_code: NYC_CITY_CODE,
    p_reopen_closed: true,
  });
  if (error) return { ok: false, message: error.message };

  revalidateSimPaths();
  const row = data as {
    created?: number;
    sim_year?: number;
    existing_active?: number;
    existing_closed?: number;
    reopened?: number;
    wards_expected?: number;
  } | null;
  const created = row?.created ?? 0;
  const reopened = row?.reopened ?? 0;
  const active = row?.existing_active ?? 0;
  if (created > 0) {
    return {
      ok: true,
      message: `Opened Class B wave (${created} new race${created === 1 ? "" : "s"} · sim year ${row?.sim_year ?? "?"})`,
    };
  }
  if (reopened > 0) {
    return {
      ok: true,
      message: `Reopened ${reopened} Class B race${reopened === 1 ? "" : "s"} (W05–W07 · sim year ${row?.sim_year ?? "?"})`,
    };
  }
  if (active > 0) {
    return {
      ok: true,
      message: `Class B wave already open (${active} active race${active === 1 ? "" : "s"} · sim year ${row?.sim_year ?? "?"}). Check Elections.`,
    };
  }
  return {
    ok: true,
    message: `No Class B races opened (expected ${row?.wards_expected ?? 3} districts · sim year ${row?.sim_year ?? "?"}). Check wards election_class.`,
  };
}

/** Move every active NYC race one phase (filing → primary → general → closed). */
export async function advanceCityElectionTrackAction(): Promise<AdvanceCitySimWeekResult> {
  const { supabase } = await requireStaffOperator();
  const { data, error } = await supabase.rpc("admin_advance_city_election_track", {
    p_city_code: NYC_CITY_CODE,
  });
  if (error) return { ok: false, message: error.message };

  revalidateSimPaths();
  const row = data as { advanced?: number } | null;
  return {
    ok: true,
    message: `Advanced ${row?.advanced ?? 0} city election(s) one phase`,
  };
}

/** Run scheduler tick without changing simulated time. */
export async function runCitySchedulerTickAction(): Promise<AdvanceCitySimWeekResult> {
  const { supabase } = await requireStaffOperator();
  const { data, error } = await supabase.rpc("tick_city_realtime_scheduler", {
    p_city_code: NYC_CITY_CODE,
  });
  if (error) return { ok: false, message: error.message };

  revalidateSimPaths();
  return resultFromTick(data as Record<string, unknown> | null, "Scheduler tick");
}

/** @deprecated Use advanceCityCyclePhaseAction — kept for any stale imports. */
export async function advanceCitySimWeekAction(_force = false): Promise<AdvanceCitySimWeekResult> {
  return advanceCityCyclePhaseAction();
}
