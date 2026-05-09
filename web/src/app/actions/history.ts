"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/is-admin";
import { throwIfPostgrestError } from "@/lib/supabase-error";

function isMissingHallOfFameSchema(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("hall_of_fame_entries") || m.includes("schema cache");
}

const HALL_OF_FAME_MIGRATION_HINT =
  "Hall of Fame table isn't set up yet. Run supabase/migrations/20260473180000_hall_of_fame_admin_entries.sql, then `notify pgrst, 'reload schema';`.";

export async function addHallOfFameEntry(formData: FormData): Promise<void> {
  const { supabase, user } = await requireAdmin();
  const userId = String(formData.get("user_id") ?? "").trim();
  const honorTitle = String(formData.get("honor_title") ?? "").trim() || "Hall of Fame";
  const noteRaw = String(formData.get("note") ?? "").trim();
  if (!userId) throw new Error("User id is required.");

  const { error } = await supabase.from("hall_of_fame_entries").insert({
    user_id: userId,
    honor_title: honorTitle,
    note: noteRaw.length ? noteRaw : null,
    is_active: true,
    created_by: user.id,
  });
  if (error && isMissingHallOfFameSchema(error.message)) {
    throw new Error(HALL_OF_FAME_MIGRATION_HINT);
  }
  throwIfPostgrestError(error);
  revalidatePath("/history");
}

export async function removeHallOfFameEntry(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const entryId = String(formData.get("entry_id") ?? "").trim();
  if (!entryId) throw new Error("Entry id is required.");
  const { error } = await supabase.from("hall_of_fame_entries").delete().eq("id", entryId);
  if (error && isMissingHallOfFameSchema(error.message)) {
    throw new Error(HALL_OF_FAME_MIGRATION_HINT);
  }
  throwIfPostgrestError(error);
  revalidatePath("/history");
}
