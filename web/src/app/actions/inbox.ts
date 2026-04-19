"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function markInboxItemRead(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("Missing item.");

  const { error } = await supabase.rpc("inbox_mark_read", { p_id: id });
  if (error) throw new Error(error.message);
  revalidatePath("/");
}
