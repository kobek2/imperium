"use server";

import { revalidatePath } from "next/cache";
import { createClient, getServerAuth } from "@/lib/supabase/server";
import { sanitizeBillHtml } from "@/lib/sanitize-bill-html";
import { generateCrisisFollowUpForArc } from "@/lib/crisis-followup";
import { throwIfPostgrestError } from "@/lib/supabase-error";

export type PresidentialStatementKind = "address" | "letter_to_congress";

export type CrisisIntentTag = "domestic" | "diplomatic" | "military" | "economic" | "";

export async function publishCrisisExecutiveOrder(formData: FormData): Promise<void> {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) throw new Error("Sign in required.");

  const storyArcId = String(formData.get("story_arc_id") ?? "").trim();
  if (!storyArcId) throw new Error("Missing crisis context.");

  const title = String(formData.get("title") ?? "").trim();
  const bodyHtmlRaw = String(formData.get("body_html") ?? "").trim();
  const bodyFallback = String(formData.get("body") ?? "").trim();
  const body = bodyHtmlRaw ? sanitizeBillHtml(bodyHtmlRaw) : bodyFallback;

  const { error } = await supabase.rpc("publish_executive_order", {
    p_title: title,
    p_body: body,
    p_story_arc_id: storyArcId,
  });
  throwIfPostgrestError(error);

  try {
    await generateCrisisFollowUpForArc(supabase, storyArcId);
  } catch (followUpErr) {
    console.warn("[publishCrisisExecutiveOrder] follow-up generation failed", followUpErr);
  }

  revalidatePath("/events");
  revalidatePath("/oval");
  revalidatePath("/");
  revalidatePath("/inbox");
}

export async function publishCrisisStatement(formData: FormData): Promise<void> {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) throw new Error("Sign in required.");

  const storyArcId = String(formData.get("story_arc_id") ?? "").trim();
  if (!storyArcId) throw new Error("Missing crisis context.");

  const kind = String(formData.get("kind") ?? "").trim() as PresidentialStatementKind;
  if (kind !== "address" && kind !== "letter_to_congress") {
    throw new Error("Invalid statement type.");
  }

  const title = String(formData.get("title") ?? "").trim();
  const bodyHtmlRaw = String(formData.get("body_html") ?? "").trim();
  const bodyFallback = String(formData.get("body") ?? "").trim();
  const body = bodyHtmlRaw ? sanitizeBillHtml(bodyHtmlRaw) : bodyFallback;
  const intentRaw = String(formData.get("intent_tag") ?? "").trim();
  const intentTag =
    intentRaw === "domestic" ||
    intentRaw === "diplomatic" ||
    intentRaw === "military" ||
    intentRaw === "economic"
      ? intentRaw
      : null;

  const { error } = await supabase.rpc("publish_presidential_statement", {
    p_title: title,
    p_body: body,
    p_kind: kind,
    p_story_arc_id: storyArcId,
    p_intent_tag: intentTag,
  });
  throwIfPostgrestError(error);

  try {
    await generateCrisisFollowUpForArc(supabase, storyArcId);
  } catch (followUpErr) {
    console.warn("[publishCrisisStatement] follow-up generation failed", followUpErr);
  }

  revalidatePath("/events");
  revalidatePath("/");
  revalidatePath("/inbox");
}
