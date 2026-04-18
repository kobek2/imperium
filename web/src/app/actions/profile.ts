"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function saveCharacter(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("You must be signed in.");
  }

  const character_name = String(formData.get("character_name") ?? "").trim();
  const date_of_birth = String(formData.get("date_of_birth") ?? "").trim();
  const residence_state = String(formData.get("residence_state") ?? "")
    .trim()
    .toUpperCase();
  const home_district_code = String(formData.get("home_district_code") ?? "").trim();
  const party = String(formData.get("party") ?? "independent");
  const bio = String(formData.get("bio") ?? "");
  const face_claim_url = String(formData.get("face_claim_url") ?? "");
  const former_positions = String(formData.get("former_positions") ?? "");

  if (!character_name) {
    throw new Error("Character name is required.");
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      character_name,
      date_of_birth: date_of_birth || null,
      residence_state: residence_state || null,
      home_district_code: home_district_code || null,
      party,
      bio,
      face_claim_url,
      former_positions,
    })
    .eq("id", user.id);

  if (profileError) {
    throw new Error(profileError.message);
  }

  // Release any legacy exclusive district claim so we never strand `claimed_by` after the
  // player moves. Home district is not exclusive — multiple players may share a district
  // and run competitively for the same House seat.
  await supabase.from("districts").update({ claimed_by: null }).eq("claimed_by", user.id);

  if (home_district_code) {
    const { data: open, error: districtReadError } = await supabase
      .from("districts")
      .select("code")
      .eq("code", home_district_code)
      .maybeSingle();

    if (districtReadError) {
      throw new Error(districtReadError.message);
    }
    if (!open) {
      throw new Error("District not found.");
    }
  }

  revalidatePath("/character");
}
