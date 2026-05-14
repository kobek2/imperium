"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  focusStyleIdToMechanism,
  isDefenseTheaterMechanism,
} from "@/lib/defense-theater";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";

async function assertSecretaryOfDefense(): Promise<{ userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required.");

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const ok =
    roleKeys.includes("secretary_of_defense") ||
    roleKeys.includes("admin") ||
    roleKeys.includes("staff_super");
  if (!ok) throw new Error("Only the Secretary of Defense may update theater posture.");

  return { userId: user.id };
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

/**
 * Sets abstract forward presence & primary mechanism for a partner / theater (not literal troop counts).
 * State still owns bilateral `us_relation` scores.
 */
export async function updateDefenseTheaterPosture(formData: FormData): Promise<void> {
  const { userId } = await assertSecretaryOfDefense();
  const supabase = await createClient();

  const nationCode = String(formData.get("nation_code") ?? "").trim().toUpperCase();
  const tierRaw = Number(formData.get("priority_tier") ?? 0);
  const presenceRaw = Number(formData.get("forward_presence_level") ?? NaN);
  const focusStyle = String(formData.get("focus_style") ?? "").trim();
  const mechanismField = String(formData.get("primary_mechanism") ?? "").trim();
  const brief = String(formData.get("theater_brief") ?? "").trim();

  if (!nationCode) throw new Error("Country code required.");
  const priority_tier = tierRaw === 1 || tierRaw === 2 || tierRaw === 3 ? tierRaw : 0;
  if (!priority_tier) throw new Error("Pick how hot this location is.");

  const fromFocus = focusStyleIdToMechanism(focusStyle);
  const mechanism =
    fromFocus ?? (isDefenseTheaterMechanism(mechanismField) ? mechanismField : null);
  if (!mechanism) throw new Error("Pick what we are doing there.");
  if (brief.length > 4000) throw new Error("Notes are too long (max 4000 characters).");

  const forward_presence_level = clampInt(presenceRaw, 0, 100);

  const { data: nation, error: nErr } = await supabase
    .from("rp_foreign_nations")
    .select("code")
    .eq("code", nationCode)
    .maybeSingle();
  if (nErr || !nation) throw new Error("Unknown country.");

  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("rp_defense_theater_posture").upsert(
    {
      nation_code: nationCode,
      priority_tier,
      forward_presence_level,
      primary_mechanism: mechanism,
      theater_brief: brief,
      updated_at: nowIso,
      updated_by: userId,
    },
    { onConflict: "nation_code" },
  );
  if (error) throw new Error(error.message);

  revalidatePath("/cabinet/defense");
  revalidatePath("/cabinet/nsc");
}
