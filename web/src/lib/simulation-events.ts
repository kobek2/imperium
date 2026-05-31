import type { SupabaseClient } from "@supabase/supabase-js";

export type SimulationEventStatus = "active" | "resolved" | "escalated" | "failed";

export type SimulationEventChoice = "strong" | "steady" | "weak" | "delay";

export type SimulationEventAssignmentRow = {
  id: string;
  instance_id: string;
  assignee_user_id: string;
  role_label: string;
  is_primary: boolean;
  completed_at: string | null;
  response_key: string | null;
};

export type SimulationEventInstanceRow = {
  id: string;
  template_key: string;
  title: string;
  summary: string;
  status: SimulationEventStatus;
  severity: number;
  deadline_at: string;
  outcome: string | null;
  opened_at: string;
};

export type UserSimulationEvent = SimulationEventInstanceRow & {
  assignment: SimulationEventAssignmentRow;
};

export const SIMULATION_EVENT_CHOICES: Array<{
  key: SimulationEventChoice;
  label: string;
  hint: string;
}> = [
  { key: "strong", label: "Decisive action", hint: "Best outcome if you are the lead assignee." },
  { key: "steady", label: "Measured response", hint: "Stabilizes the situation." },
  { key: "weak", label: "Minimal effort", hint: "Risks escalation and approval loss." },
  { key: "delay", label: "Kick the can", hint: "Often worsens national metrics." },
];

export async function runSimulationEventsDailyTick(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("rp_simulation_events_daily_tick");
  if (error) console.warn("[runSimulationEventsDailyTick]", error.message);
}

export async function fetchUserSimulationEvents(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserSimulationEvent[]> {
  const { data: assignments, error: aErr } = await supabase
    .from("simulation_event_assignments")
    .select("id, instance_id, assignee_user_id, role_label, is_primary, completed_at, response_key")
    .eq("assignee_user_id", userId)
    .is("completed_at", null)
    .order("id", { ascending: true });
  if (aErr || !assignments?.length) return [];

  const instanceIds = [...new Set(assignments.map((a) => String((a as { instance_id: string }).instance_id)))];
  const { data: instances, error: iErr } = await supabase
    .from("simulation_event_instances")
    .select("id, template_key, title, summary, status, severity, deadline_at, outcome, opened_at")
    .in("id", instanceIds)
    .eq("status", "active");
  if (iErr || !instances?.length) return [];

  const byId = new Map(
    (instances as SimulationEventInstanceRow[]).map((i) => [i.id, i] as const),
  );

  const out: UserSimulationEvent[] = [];
  for (const row of assignments as SimulationEventAssignmentRow[]) {
    const inst = byId.get(row.instance_id);
    if (!inst) continue;
    out.push({ ...inst, assignment: row });
  }
  return out.sort(
    (a, b) => new Date(a.deadline_at).getTime() - new Date(b.deadline_at).getTime(),
  );
}
