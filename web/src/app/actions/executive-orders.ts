"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sanitizeBillHtml } from "@/lib/sanitize-bill-html";
import { throwIfPostgrestError } from "@/lib/supabase-error";

export async function savePresidentialSignature(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const sig = String(formData.get("presidential_signature") ?? "").trim();
  const { error } = await supabase.rpc("save_presidential_signature", { p_signature: sig });
  throwIfPostgrestError(error);
  revalidatePath("/oval");
}

export async function publishExecutiveOrder(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const title = String(formData.get("title") ?? "").trim();
  const bodyHtmlRaw = String(formData.get("body_html") ?? "").trim();
  const bodyFallback = String(formData.get("body") ?? "").trim();
  const body = bodyHtmlRaw ? sanitizeBillHtml(bodyHtmlRaw) : bodyFallback;
  const storyArcRaw = String(formData.get("story_arc_id") ?? "").trim();
  const { error } = await supabase.rpc("publish_executive_order", {
    p_title: title,
    p_body: body,
    p_story_arc_id: storyArcRaw || null,
  });
  throwIfPostgrestError(error);
  revalidatePath("/oval");
  revalidatePath("/");
  revalidatePath("/inbox");
}
