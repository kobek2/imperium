import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/server";
import { pickDiscordUsername } from "@/lib/discord-username";
import { isProfileOnboardingComplete } from "@/lib/character-onboarding";
import { formatPrimaryGovernmentTitle } from "@/lib/government-role-display";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { PersonnelEditShell } from "./personnel-edit-shell";
import type { PersonnelProfile } from "./personnel-record";

export default async function CharacterPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Configure Supabase keys in <code className="font-mono">web/.env.local</code>{" "}
        to enable character creation.
      </div>
    );
  }

  if (!user) {
    redirect("/login");
  }

  let { data: profile } = await supabase
    .from("profiles")
    .select(
      "character_name, date_of_birth, residence_state, home_district_code, party, bio, face_claim_url, former_positions, discord_username, office_role",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/login");
  }

  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const idData = user.identities?.[0]?.identity_data as Record<string, unknown> | undefined;
  const syncedName = pickDiscordUsername(meta) ?? pickDiscordUsername(idData);
  if (syncedName && syncedName !== profile.discord_username) {
    await supabase.from("profiles").update({ discord_username: syncedName }).eq("id", user.id);
    profile = { ...profile, discord_username: syncedName };
  }

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const primaryTitle = formatPrimaryGovernmentTitle(roleKeys);

  const personnelProfile: PersonnelProfile = {
    character_name: profile.character_name,
    date_of_birth: profile.date_of_birth,
    residence_state: profile.residence_state,
    home_district_code: profile.home_district_code,
    party: profile.party,
    bio: profile.bio,
    face_claim_url: profile.face_claim_url,
    former_positions: profile.former_positions,
    discord_username: profile.discord_username,
  };

  const setupMode = !isProfileOnboardingComplete(profile);

  return (
    <PersonnelEditShell
      primaryTitle={primaryTitle}
      profile={personnelProfile}
      setupMode={setupMode}
    />
  );
}
