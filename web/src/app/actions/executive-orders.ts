"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
  const body = String(formData.get("body") ?? "").trim();
  const { error } = await supabase.rpc("publish_executive_order", { p_title: title, p_body: body });
  throwIfPostgrestError(error);
  revalidatePath("/oval");
  revalidatePath("/");
  revalidatePath("/inbox");
}
