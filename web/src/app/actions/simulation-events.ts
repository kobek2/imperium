"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/is-admin";
import { getStaffAccess, requireAnyStaffPermission } from "@/lib/staff-access";
import { createClient, getServerAuth } from "@/lib/supabase/server";
import { throwIfPostgrestError } from "@/lib/supabase-error";
import type { SimulationEventChoice } from "@/lib/simulation-events";

const VALID: SimulationEventChoice[] = ["strong", "steady", "weak", "delay"];

export async function respondToSimulationEvent(
  instanceId: string,
  choiceKey: SimulationEventChoice,
): Promise<void> {
  if (!VALID.includes(choiceKey)) throw new Error("Invalid response.");
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) throw new Error("Sign in required.");

  const { error } = await supabase.rpc("respond_simulation_event", {
    p_instance_id: instanceId,
    p_choice_key: choiceKey,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/events");
  revalidatePath("/");
}

export async function adminPublishWireArticle(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const mode = String(formData.get("mode") ?? "new").trim();
  const templateKey = String(formData.get("template_key") ?? "").trim() || null;
  const parentRaw = String(formData.get("parent_instance_id") ?? "").trim();
  const parentId = parentRaw || null;
  const title = String(formData.get("title") ?? "").trim() || null;
  const summary = String(formData.get("summary") ?? "").trim() || null;
  const body = String(formData.get("body") ?? "").trim() || null;
  const dateline = String(formData.get("dateline") ?? "").trim() || null;
  const beatLabel = String(formData.get("beat_label") ?? "").trim() || null;
  const hoursRaw = Number(String(formData.get("hours") ?? "24").trim());
  const hours = Number.isFinite(hoursRaw) ? Math.max(4, Math.min(72, Math.floor(hoursRaw))) : 24;

  if (mode === "new") {
    if (!templateKey) throw new Error("Pick a story from the pool.");
    const { error } = await supabase.rpc("admin_publish_wire_article", {
      p_template_key: templateKey,
      p_parent_instance_id: null,
      p_title: null,
      p_summary: null,
      p_body: null,
      p_dateline: null,
      p_hours: null,
      p_beat_label: "breaking",
    });
    if (error) throw new Error(error.message);
  } else if (mode === "continue") {
    if (!parentId || !templateKey) throw new Error("Pick a story arc and follow-up.");
    const { error } = await supabase.rpc("admin_publish_wire_article", {
      p_template_key: templateKey,
      p_parent_instance_id: parentId,
      p_title: null,
      p_summary: null,
      p_body: null,
      p_dateline: null,
      p_hours: null,
      p_beat_label: beatLabel ?? "developing",
    });
    if (error) throw new Error(error.message);
  } else if (mode === "custom") {
    if (!title || !summary) throw new Error("Headline and lede are required.");
    const { error } = await supabase.rpc("admin_publish_wire_article", {
      p_template_key: null,
      p_parent_instance_id: parentId,
      p_title: title,
      p_summary: summary,
      p_body: body,
      p_dateline: dateline,
      p_hours: hours,
      p_beat_label: parentId ? beatLabel ?? "developing" : "breaking",
    });
    if (error) throw new Error(error.message);
  } else {
    throw new Error("Unknown publish mode.");
  }

  revalidatePath("/events");
  revalidatePath("/admin/elections");
}

/** @deprecated Use adminPublishWireArticle */
export async function adminSpawnWireEvent(formData: FormData): Promise<void> {
  await adminPublishWireArticle(formData);
}

export async function adminRunWireEventsTick(): Promise<void> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_wire_events_tick", { p_force: true });
  if (error) throw new Error(error.message);

  revalidatePath("/events");
  revalidatePath("/admin/elections");
}

/** Staff: remove a published wire article (and its assignments). */
export async function deleteWireArticle(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const access = await getStaffAccess();
  if (!access) throw new Error("Unauthorized");
  requireAnyStaffPermission(access, ["elections", "simulation"]);

  const instanceId = String(formData.get("instance_id") ?? "").trim();
  if (!instanceId) throw new Error("Missing article id.");

  const { data: row } = await supabase
    .from("simulation_event_instances")
    .select("id")
    .eq("id", instanceId)
    .maybeSingle();
  if (!row) throw new Error("Article not found.");

  const { error } = await supabase.from("simulation_event_instances").delete().eq("id", instanceId);
  throwIfPostgrestError(error);

  revalidatePath("/events");
  revalidatePath("/admin/elections");
}
