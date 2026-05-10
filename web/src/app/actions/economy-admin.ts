"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStaffAccessOrThrow } from "@/lib/staff-access";
import { STAFF_GRANT_KEYS } from "@/lib/staff-permissions";

function canAdjustWallets(roleKeys: readonly string[], hasFullStaff: boolean): boolean {
  if (hasFullStaff) return true;
  return roleKeys.includes(STAFF_GRANT_KEYS.economy);
}

export async function staffAdjustWalletBalance(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const access = await getStaffAccessOrThrow();
  if (!canAdjustWallets(access.roleKeys, access.hasFullStaff)) {
    return { ok: false, message: "You need staff_economy or full staff (admin / staff_super) to adjust balances." };
  }

  const userId = String(formData.get("user_id") ?? "").trim();
  const amountRaw = String(formData.get("amount_usd") ?? "").trim().replace(/,/g, "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return { ok: false, message: "Enter a valid user UUID (profile id)." };
  }

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount === 0) {
    return { ok: false, message: "Amount must be a non-zero number (use negative to take away)." };
  }

  const delta = Math.round(amount * 100) / 100;
  if (Math.abs(delta) > 500_000_000) {
    return { ok: false, message: "Amount exceeds per-call limit ($500,000,000)." };
  }

  if (reason.length < 3) {
    return { ok: false, message: "Reason must be at least 3 characters (audit trail)." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("economy_staff_adjust_wallet", {
    p_user_id: userId,
    p_delta: delta,
    p_reason: reason.slice(0, 500),
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  const bal = (data as { balance?: number } | null)?.balance;
  revalidatePath("/admin/economy");
  revalidatePath("/economy");
  revalidatePath("/economy/leaderboard");
  revalidatePath("/admin/economy/overview");

  const suffix = bal != null && Number.isFinite(Number(bal)) ? ` New balance: $${Number(bal).toLocaleString()}.` : "";
  return { ok: true, message: `Applied ${delta >= 0 ? "+" : ""}$${Math.abs(delta).toLocaleString()} to wallet.${suffix}` };
}
