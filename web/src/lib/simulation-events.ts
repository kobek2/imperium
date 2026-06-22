import type { SupabaseClient } from "@supabase/supabase-js";
import { wireArticlePlainText } from "@/lib/wire-article-format";

export type SimulationEventStatus = "active" | "resolved" | "escalated" | "failed";

export type SimulationEventChoice = "strong" | "steady" | "weak" | "delay";

export type WireScope = "domestic" | "international" | "campaign" | "congress" | "executive" | "economy" | "cabinet";

export type WireBeatLabel = "breaking" | "developing" | "update" | "analysis" | "escalation";

/** @deprecated Use WireScope */
export type SimulationEventCategory = WireScope;

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
  body?: string | null;
  dateline?: string | null;
  status: SimulationEventStatus;
  severity: number;
  deadline_at: string;
  outcome: string | null;
  opened_at: string;
  resolved_at?: string | null;
  story_arc_id?: string;
  parent_instance_id?: string | null;
  beat_number?: number;
  beat_label?: WireBeatLabel;
};

export type WireFeedItem = SimulationEventInstanceRow & {
  category: WireScope;
  topic: string;
  metadata?: Record<string, unknown>;
};

export type NewsStoryArc = {
  arcId: string;
  beats: WireFeedItem[];
  latest: WireFeedItem;
  isActive: boolean;
  maxSeverity: number;
};

export type NewsPoolTemplate = {
  template_key: string;
  title: string;
  summary: string;
  body?: string | null;
  dateline?: string | null;
  category: WireScope;
  topic: string;
  is_starter: boolean;
  follow_up_of_template_key: string | null;
  default_severity: number;
};

export type StoryContinueTarget = {
  instance_id: string;
  title: string;
  template_key: string;
  story_arc_id: string;
  beat_number: number;
  status: SimulationEventStatus;
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
  { key: "delay", label: "Kick the can", hint: "Often worsens the story on the wire." },
];

export const WIRE_FEED_LIMIT = 60;

const STATUS_LABELS: Record<SimulationEventStatus, string> = {
  active: "LIVE",
  resolved: "Resolved",
  escalated: "Escalating",
  failed: "Unresolved",
};

const BEAT_LABELS: Record<WireBeatLabel, string> = {
  breaking: "Breaking",
  developing: "Developing",
  update: "Update",
  analysis: "Analysis",
  escalation: "Escalation",
};

const SCOPE_LABELS: Record<WireScope, string> = {
  domestic: "United States",
  international: "World",
  campaign: "Campaign",
  congress: "Capitol",
  executive: "Executive",
  economy: "Economy",
  cabinet: "Cabinet",
};

const TOPIC_LABELS: Record<string, string> = {
  immigration: "Immigration",
  guns: "Gun violence",
  abortion: "Abortion rights",
  healthcare: "Healthcare",
  terrorism: "Terrorism",
  war: "War & conflict",
  borders: "Borders",
  security: "National security",
  drugs: "Drugs",
  economy: "Economy",
  humanitarian: "Humanitarian",
  diplomacy: "Diplomacy",
  conflict: "Conflict",
  general: "General",
};

export function wireStatusLabel(status: SimulationEventStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function wireBeatLabel(label: WireBeatLabel | string | undefined): string {
  if (!label) return "Update";
  return BEAT_LABELS[label as WireBeatLabel] ?? label;
}

export function wireScopeLabel(scope: WireScope): string {
  return SCOPE_LABELS[scope] ?? scope;
}

/** @deprecated Use wireScopeLabel */
export function wireCategoryLabel(category: WireScope): string {
  return wireScopeLabel(category);
}

export function wireTopicLabel(topic: string): string {
  return TOPIC_LABELS[topic] ?? topic.replace(/_/g, " ");
}

export function wireDeadlineLabel(iso: string): string {
  const d = new Date(iso);
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return "Past due";
  const h = Math.floor(ms / 3_600_000);
  if (h < 48) return `${h}h left`;
  const days = Math.floor(h / 24);
  return `${days}d left`;
}

export function formatWireCopyBlock(
  item: WireFeedItem,
  opts?: { siteUrl?: string; arcBeat?: number; arcTotal?: number },
): string {
  const base = (opts?.siteUrl ?? "https://imperium.app").replace(/\/+$/, "");
  const beatTag =
    opts?.arcTotal && opts.arcTotal > 1
      ? ` · Part ${opts.arcBeat ?? item.beat_number ?? 1} of ${opts.arcTotal}`
      : "";
  const urgency = item.status === "active" ? "BREAKING" : "UPDATE";
  const header = `${urgency} — Imperium Newsroom | ${wireScopeLabel(item.category)} | ${wireTopicLabel(item.topic)}${beatTag}`;
  const article = wireArticlePlainText({
    title: `${wireBeatLabel(item.beat_label)}: ${item.title}`,
    summary: item.summary,
    dateline: item.dateline,
    body: item.body,
    publishedAt: item.opened_at,
  });
  const footer = [
    `Status: ${wireStatusLabel(item.status)} · Severity ${item.severity}/5 · ${wireDeadlineLabel(item.deadline_at)}`,
  ];
  if (item.outcome && item.status !== "active") {
    footer.push(`Outcome: ${item.outcome}`);
  }
  footer.push(`→ ${base}/events#evt-${item.id}`);
  return [header, "", article, "", ...footer].join("\n");
}

export function groupWireIntoArcs(items: WireFeedItem[]): NewsStoryArc[] {
  const byArc = new Map<string, WireFeedItem[]>();
  for (const item of items) {
    const arcId = item.story_arc_id ?? item.id;
    const list = byArc.get(arcId) ?? [];
    list.push(item);
    byArc.set(arcId, list);
  }

  const arcs: NewsStoryArc[] = [];
  for (const [arcId, beats] of byArc) {
    const sorted = [...beats].sort(
      (a, b) => (a.beat_number ?? 1) - (b.beat_number ?? 1) || new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime(),
    );
    const latest = sorted[sorted.length - 1]!;
    arcs.push({
      arcId,
      beats: sorted,
      latest,
      isActive: sorted.some((b) => b.status === "active"),
      maxSeverity: Math.max(...sorted.map((b) => b.severity)),
    });
  }

  return arcs.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return new Date(b.latest.opened_at).getTime() - new Date(a.latest.opened_at).getTime();
  });
}

export async function runSimulationEventsDailyTick(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("rp_simulation_events_daily_tick");
  if (error) console.warn("[runSimulationEventsDailyTick]", error.message);
}

export async function runAdminWireEventsTick(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("admin_wire_events_tick", { p_force: true });
  if (error) console.warn("[runAdminWireEventsTick]", error.message);
}

function enrichWireItems(
  instances: SimulationEventInstanceRow[],
  templates: Array<{ template_key: string; category: WireScope; topic: string }>,
): WireFeedItem[] {
  const metaByKey = new Map(
    templates.map((t) => [t.template_key, { category: t.category, topic: t.topic }] as const),
  );

  return instances.map((inst) => {
    const row = inst as SimulationEventInstanceRow & { metadata?: { category?: string; topic?: string } };
    const meta = row.metadata ?? {};
    const tpl = metaByKey.get(inst.template_key);
    return {
      ...inst,
      metadata: meta as Record<string, unknown>,
      category: (meta.category as WireScope) ?? tpl?.category ?? "domestic",
      topic: (meta.topic as string) ?? tpl?.topic ?? "general",
      beat_label: (inst.beat_label ?? "breaking") as WireBeatLabel,
    };
  });
}

export async function fetchWireFeed(supabase: SupabaseClient): Promise<WireFeedItem[]> {
  const { data: instances, error: iErr } = await supabase
    .from("simulation_event_instances")
    .select(
      "id, template_key, title, summary, body, dateline, status, severity, deadline_at, outcome, opened_at, resolved_at, story_arc_id, parent_instance_id, beat_number, beat_label, metadata",
    )
    .order("opened_at", { ascending: false })
    .limit(WIRE_FEED_LIMIT);
  if (iErr || !instances?.length) return [];

  const templateKeys = [...new Set(instances.map((i) => String((i as { template_key: string }).template_key)))];
  const { data: templates } = await supabase
    .from("simulation_event_templates")
    .select("template_key, category, topic")
    .in("template_key", templateKeys);

  return enrichWireItems(
    instances as SimulationEventInstanceRow[],
    (templates ?? []) as Array<{ template_key: string; category: WireScope; topic: string }>,
  );
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

export async function fetchNewsPoolTemplates(supabase: SupabaseClient): Promise<NewsPoolTemplate[]> {
  const { data, error } = await supabase
    .from("simulation_event_templates")
    .select(
      "template_key, title, summary, category, topic, is_starter, follow_up_of_template_key, default_severity",
    )
    .eq("enabled", true)
    .like("template_key", "news_%")
    .order("category", { ascending: true })
    .order("is_starter", { ascending: false })
    .order("title", { ascending: true });
  if (error || !data?.length) return [];
  return data as NewsPoolTemplate[];
}

/** @deprecated Use fetchNewsPoolTemplates */
export async function fetchEnabledWireTemplates(
  supabase: SupabaseClient,
): Promise<Array<{ template_key: string; title: string; category: WireScope }>> {
  const pool = await fetchNewsPoolTemplates(supabase);
  return pool.map((t) => ({ template_key: t.template_key, title: t.title, category: t.category }));
}

export async function fetchStoryContinueTargets(
  supabase: SupabaseClient,
): Promise<StoryContinueTarget[]> {
  const { data, error } = await supabase
    .from("simulation_event_instances")
    .select("id, title, template_key, story_arc_id, beat_number, status, opened_at")
    .order("opened_at", { ascending: false })
    .limit(30);
  if (error || !data?.length) return [];

  const rows = data as Array<{
    id: string;
    title: string;
    template_key: string;
    story_arc_id: string;
    beat_number: number;
    status: SimulationEventStatus;
    opened_at: string;
  }>;

  const latestByArc = new Map<string, (typeof rows)[0]>();
  for (const row of rows) {
    const prev = latestByArc.get(row.story_arc_id);
    if (!prev || row.beat_number >= prev.beat_number) {
      latestByArc.set(row.story_arc_id, row);
    }
  }

  return [...latestByArc.values()]
    .sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime())
    .map((r) => ({
      instance_id: r.id,
      title: r.title,
      template_key: r.template_key,
      story_arc_id: r.story_arc_id,
      beat_number: r.beat_number,
      status: r.status,
    }));
}
