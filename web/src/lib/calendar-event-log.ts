import type { SupabaseClient } from "@supabase/supabase-js";

export type CalendarEventStatus = "success" | "error";

const ERR_MAX = 8000;

/** True when a successful row exists for this milestone key (errors do not count). */
export async function calendarSuccessExists(supabase: SupabaseClient, eventKey: string): Promise<boolean> {
  const { data } = await supabase
    .from("simulation_calendar_events")
    .select("id")
    .eq("event_key", eventKey)
    .eq("status", "success")
    .maybeSingle();
  return Boolean(data);
}

/** Keys that have completed successfully (used for dedupe in the tick engine). */
export async function loadSuccessfulCalendarEventKeys(supabase: SupabaseClient): Promise<Set<string>> {
  const { data } = await supabase.from("simulation_calendar_events").select("event_key").eq("status", "success");
  const keys = new Set<string>();
  for (const row of data ?? []) {
    const k = (row as { event_key: string }).event_key;
    if (k) keys.add(k);
  }
  return keys;
}

export async function insertCalendarEventSuccess(
  supabase: SupabaseClient,
  eventKey: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await supabase.from("simulation_calendar_events").insert({
    event_key: eventKey,
    status: "success" as const,
    error_message: null,
    metadata,
  });
}

/**
 * Records a failed calendar run. Does not block retries: callers should only insert success
 * after a full handler completes, so the same milestone key may have many error rows.
 */
export async function insertCalendarEventError(
  supabase: SupabaseClient,
  params: {
    event_key: string;
    error_message: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const msg = params.error_message.trim().slice(0, ERR_MAX);
  const { error } = await supabase.from("simulation_calendar_events").insert({
    event_key: params.event_key,
    status: "error" as const,
    error_message: msg || "(empty message)",
    metadata: params.metadata ?? {},
  });
  if (error) {
    console.warn("[calendar-event-log] insertCalendarEventError failed:", error.message, params.event_key);
  }
}

export async function getSuccessfulCalendarEventFiredAt(
  supabase: SupabaseClient,
  eventKey: string,
): Promise<Date | null> {
  const { data } = await supabase
    .from("simulation_calendar_events")
    .select("fired_at")
    .eq("event_key", eventKey)
    .eq("status", "success")
    .order("fired_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const d = new Date(String((data as { fired_at: string }).fired_at));
  return Number.isNaN(d.getTime()) ? null : d;
}
