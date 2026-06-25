import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildGenericFollowUp,
  generateCrisisFollowUpWithAi,
  normalizeDocumentBody,
  type CrisisFollowUpContext,
  type CrisisInstrument,
} from "@/lib/crisis-followup-ai";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";
import { throwIfPostgrestError } from "@/lib/supabase-error";

type CrisisResponseRow = {
  id: string;
  story_arc_id: string;
  instrument: CrisisInstrument;
  intent_tag: string | null;
  document_table: string;
  document_id: string;
  followup_instance_id: string | null;
};

async function loadDocument(
  supabase: SupabaseClient,
  table: string,
  id: string,
): Promise<{ title: string; body: string } | null> {
  if (table === "executive_orders") {
    const { data } = await supabase
      .from("executive_orders")
      .select("title, body")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return { title: data.title, body: normalizeDocumentBody(data.body) };
  }
  if (table === "presidential_statements") {
    const { data } = await supabase
      .from("presidential_statements")
      .select("title, body")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return { title: data.title, body: normalizeDocumentBody(data.body) };
  }
  if (table === "bills") {
    const { data } = await supabase
      .from("bills")
      .select("title, content_md, content_html")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const body = data.content_md?.trim()
      ? data.content_md
      : normalizeDocumentBody(data.content_html ?? "");
    return { title: data.title, body };
  }
  return null;
}

async function loadCrisisContext(
  supabase: SupabaseClient,
  storyArcId: string,
): Promise<{
  title: string;
  summary: string;
  body: string;
  dateline: string | null;
  topic: string;
  category: string;
} | null> {
  const { data: beat } = await supabase
    .from("simulation_event_instances")
    .select("title, summary, body, dateline, metadata, template_key, beat_number")
    .eq("story_arc_id", storyArcId)
    .order("beat_number", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!beat) return null;

  const meta = (beat.metadata ?? {}) as Record<string, unknown>;
  let topic = String(meta.topic ?? "");
  let category = String(meta.category ?? "");

  if (!topic || !category) {
    const { data: tpl } = await supabase
      .from("simulation_event_templates")
      .select("topic, category")
      .eq("template_key", beat.template_key)
      .maybeSingle();
    topic = topic || tpl?.topic || "general";
    category = category || tpl?.category || "domestic";
  }

  return {
    title: beat.title,
    summary: beat.summary,
    body: beat.body ?? "",
    dateline: beat.dateline,
    topic,
    category,
  };
}

async function buildContext(
  supabase: SupabaseClient,
  response: CrisisResponseRow,
): Promise<CrisisFollowUpContext | null> {
  const [crisis, document] = await Promise.all([
    loadCrisisContext(supabase, response.story_arc_id),
    loadDocument(supabase, response.document_table, response.document_id),
  ]);
  if (!crisis || !document?.body.trim()) return null;

  return {
    instrument: response.instrument,
    intentTag: response.intent_tag,
    crisisTitle: crisis.title,
    crisisSummary: crisis.summary,
    crisisBody: crisis.body,
    crisisDateline: crisis.dateline,
    crisisTopic: crisis.topic,
    crisisCategory: crisis.category,
    documentTitle: document.title,
    documentBody: document.body,
  };
}

async function publishFollowUp(
  supabase: SupabaseClient,
  responseId: string,
  draft: { title: string; summary: string; body: string; dateline: string },
  useServiceRole: boolean,
): Promise<string | null> {
  const args = {
    p_response_id: responseId,
    p_title: draft.title,
    p_summary: draft.summary,
    p_body: draft.body,
    p_dateline: draft.dateline,
    p_beat_label: "developing",
  };

  if (useServiceRole) {
    const { data, error } = await supabase.rpc("publish_crisis_generated_beat_service", args);
    throwIfPostgrestError(error);
    return data as string | null;
  }

  const { data, error } = await supabase.rpc("publish_crisis_generated_beat", args);
  throwIfPostgrestError(error);
  return data as string | null;
}

async function publishStaticFallback(
  supabase: SupabaseClient,
  responseId: string,
  useServiceRole: boolean,
): Promise<string | null> {
  const rpc = useServiceRole ? "publish_crisis_static_followup_service" : "publish_crisis_static_followup";
  const { data, error } = await supabase.rpc(rpc, { p_response_id: responseId });
  if (error) {
    console.warn("[publishStaticFallback]", error.message);
    return null;
  }
  return data as string | null;
}

/** Generate and publish a wire follow-up for one crisis response. */
export async function generateCrisisFollowUpForResponse(
  supabase: SupabaseClient,
  responseId: string,
  opts?: { useServiceRole?: boolean },
): Promise<string | null> {
  const useServiceRole = opts?.useServiceRole ?? false;

  const { data: response, error } = await supabase
    .from("simulation_event_responses")
    .select("id, story_arc_id, instrument, intent_tag, document_table, document_id, followup_instance_id")
    .eq("id", responseId)
    .maybeSingle();
  if (error || !response) return null;
  if (response.followup_instance_id) return response.followup_instance_id;

  const ctx = await buildContext(supabase, response as CrisisResponseRow);
  if (!ctx) return null;

  const aiDraft = await generateCrisisFollowUpWithAi(ctx);
  if (aiDraft) {
    const id = await publishFollowUp(supabase, responseId, aiDraft, useServiceRole);
    if (id) return id;
  }

  const staticId = await publishStaticFallback(supabase, responseId, useServiceRole);
  if (staticId) return staticId;

  const generic = buildGenericFollowUp(ctx);
  return publishFollowUp(supabase, responseId, generic, useServiceRole);
}

/** After a crisis instrument is filed, generate follow-up for the latest response on the arc. */
export async function generateCrisisFollowUpForArc(
  supabase: SupabaseClient,
  storyArcId: string,
): Promise<string | null> {
  const { data: response } = await supabase
    .from("simulation_event_responses")
    .select("id, followup_instance_id")
    .eq("story_arc_id", storyArcId)
    .is("followup_instance_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!response?.id) return null;
  return generateCrisisFollowUpForResponse(supabase, response.id);
}

/** Process crisis responses that never received a follow-up (e.g. bill enactment via DB trigger). */
export async function processPendingCrisisFollowUps(limit = 3): Promise<number> {
  const supabase = createServiceRoleSupabase();
  if (!supabase) return 0;

  const { data: pending } = await supabase
    .from("simulation_event_responses")
    .select("id")
    .is("followup_instance_id", null)
    .in("instrument", [
      "executive_order",
      "presidential_statement",
      "letter_to_congress",
      "bill_filed",
      "bill_enacted",
    ])
    .order("created_at", { ascending: true })
    .limit(limit);

  let published = 0;
  for (const row of pending ?? []) {
    const id = await generateCrisisFollowUpForResponse(supabase, row.id, { useServiceRole: true });
    if (id) published += 1;
  }
  return published;
}
