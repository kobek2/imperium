"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";
import type { NationalMetricsRow } from "@/lib/national-metrics-types";

function revalidateNationalMetrics() {
  revalidatePath("/national-metrics");
  revalidatePath("/directory");
  revalidatePath("/economy/federal");
}

/** Payload: all keys optional; omitted keys leave DB values unchanged (RPC uses coalesce). */
export async function updateNationalMetrics(
  fiscalYearId: string,
  patch: Partial<Omit<NationalMetricsRow, "fiscal_year_id" | "updated_at" | "updated_by">>,
  options?: { reason?: string | null },
): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const admin = await getIsAdmin();
  if (!admin) return { ok: false, message: "Only admins may edit national metrics." };

  const { error } = await supabase.rpc("national_metrics_admin_upsert", {
    p_fiscal_year_id: fiscalYearId,
    p_payload: patch,
    p_reason: options?.reason?.trim() ? options.reason.trim() : null,
  });
  if (error) return { ok: false, message: error.message };
  revalidateNationalMetrics();
  return { ok: true, message: "National metrics saved." };
}
