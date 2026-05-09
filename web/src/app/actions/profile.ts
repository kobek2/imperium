"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isProfileOnboardingComplete, US_STATE_CODES } from "@/lib/character-onboarding";

const STATE_SET = new Set<string>(US_STATE_CODES);
const PARTIES = new Set(["democrat", "republican", "independent"]);

const PORTRAIT_MAX_BYTES = 5 * 1024 * 1024;

function extFromImageMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}

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
  const former_positions = String(formData.get("former_positions") ?? "");

  const portrait = formData.get("portrait");

  const { data: beforeProfile, error: beforeErr } = await supabase
    .from("profiles")
    .select("character_name, date_of_birth, residence_state, home_district_code, party, face_claim_url")
    .eq("id", user.id)
    .maybeSingle();

  if (beforeErr) {
    throw new Error(beforeErr.message);
  }

  let face_claim_url = String(
    (beforeProfile as { face_claim_url?: string | null } | null)?.face_claim_url ?? "",
  ).trim();

  if (portrait instanceof File && portrait.size > 0) {
    if (portrait.size > PORTRAIT_MAX_BYTES) {
      throw new Error("Portrait file must be 5MB or smaller.");
    }
    if (!portrait.type.startsWith("image/")) {
      throw new Error("Portrait must be an image (JPEG, PNG, WebP, or GIF).");
    }
    const ext = extFromImageMime(portrait.type);
    const path = `${user.id}/face.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("face_claims")
      .upload(path, portrait, { upsert: true, contentType: portrait.type });
    if (uploadErr) {
      console.error("[saveCharacter] portrait upload failed", {
        path,
        contentType: portrait.type,
        sizeBytes: portrait.size,
        message: uploadErr.message,
      });
      const lower = uploadErr.message.toLowerCase();
      if (lower.includes("bucket") || lower.includes("not found")) {
        throw new Error(
          "Portrait storage is not set up on this project yet. Ask an admin to run the latest Supabase migration (face_claims storage bucket).",
        );
      }
      if (lower.includes("row-level security") || lower.includes("rls") || lower.includes("policy")) {
        throw new Error(
          "Portrait upload was blocked by storage permissions. Please sign out and back in, then try again.",
        );
      }
      if (lower.includes("payload") || lower.includes("too large") || lower.includes("exceeded")) {
        throw new Error(
          "Portrait upload exceeded the server limit. Please try a smaller image (under 5MB).",
        );
      }
      throw new Error(`Portrait upload failed: ${uploadErr.message}`);
    }
    const { data: pub } = supabase.storage.from("face_claims").getPublicUrl(path);
    // Append a cache-busting version param. The storage path is always
    // `{user_id}/face.{ext}`, so without this every browser keeps showing
    // the previous portrait it cached at the same URL.
    face_claim_url = `${pub.publicUrl}?v=${Date.now()}`;
  }

  if (!character_name) {
    throw new Error("Character name is required.");
  }
  if (!date_of_birth) {
    throw new Error("Date of birth is required.");
  }
  const dobMs = new Date(`${date_of_birth}T12:00:00Z`).getTime();
  if (!Number.isFinite(dobMs)) {
    throw new Error("Date of birth is not a valid date.");
  }
  if (!STATE_SET.has(residence_state)) {
    throw new Error("Choose a valid U.S. state (two-letter code).");
  }
  if (!home_district_code) {
    throw new Error("Home congressional district is required.");
  }
  if (!PARTIES.has(party)) {
    throw new Error("Choose a valid party.");
  }

  const wasOnboardingComplete = isProfileOnboardingComplete(beforeProfile);
  const isFirstOnboardingCompletion = !wasOnboardingComplete;

  // Release any legacy exclusive district claim so we never strand `claimed_by` after the
  // player moves. Home district is not exclusive — multiple players may share a district
  // and run competitively for the same House seat.
  await supabase.from("districts").update({ claimed_by: null }).eq("claimed_by", user.id);

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

  if (
    !isProfileOnboardingComplete({
      character_name,
      date_of_birth,
      residence_state,
      home_district_code,
      party,
    })
  ) {
    throw new Error("Character record is incomplete.");
  }

  const profileUpdate: Record<string, unknown> = {
    character_name,
    date_of_birth: date_of_birth || null,
    residence_state: residence_state || null,
    home_district_code: home_district_code || null,
    party,
    bio,
    face_claim_url,
    former_positions,
  };
  if (isFirstOnboardingCompletion) {
    profileUpdate.orientation_step = 1;
  }

  const { error: profileError } = await supabase.from("profiles").update(profileUpdate).eq("id", user.id);

  if (profileError) {
    throw new Error(profileError.message);
  }

  // Only the first time a profile crosses from "incomplete" to "complete" may auto-open seat
  // filing races. Editing an already-registered character must not spawn new elections.
  if (isFirstOnboardingCompletion) {
    try {
      const { error: autoSeatErr } = await supabase.rpc("auto_create_seat_elections_for_onboarding");
      if (autoSeatErr) {
        console.warn("[saveCharacter] auto_create_seat_elections_for_onboarding:", autoSeatErr.message);
      }
    } catch (e) {
      console.warn("[saveCharacter] auto seat elections RPC failed:", e instanceof Error ? e.message : e);
    }
  }

  revalidatePath("/character");
  revalidatePath("/onboarding");
  revalidatePath("/elections");
  revalidatePath("/");
  revalidatePath("/directory");
  revalidatePath(`/profile/${user.id}`);
}
