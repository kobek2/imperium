import { redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import { pickDiscordUsername } from "@/lib/discord-username";
import { isProfileOnboardingComplete } from "@/lib/character-onboarding";
import { CharacterForm } from "../character/character-form";

export default async function OnboardingPage() {
  const supabase = await tryCreateClient();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Configure Supabase keys in <code className="font-mono">web/.env.local</code> to continue.
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let { data: profile } = await supabase
    .from("profiles")
    .select(
      "character_name, date_of_birth, residence_state, home_district_code, party, bio, face_claim_url, former_positions, discord_username",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) redirect("/login");

  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const idData = user.identities?.[0]?.identity_data as Record<string, unknown> | undefined;
  const syncedName = pickDiscordUsername(meta) ?? pickDiscordUsername(idData);
  if (syncedName && syncedName !== profile.discord_username) {
    await supabase.from("profiles").update({ discord_username: syncedName }).eq("id", user.id);
    profile = { ...profile, discord_username: syncedName };
  }

  if (isProfileOnboardingComplete(profile)) {
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2 border-b border-[var(--psc-border)] pb-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--psc-muted)]">
          One-time setup
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">
          Create your character
        </h1>
        <p className="max-w-2xl text-sm text-[var(--psc-muted)]">
          Before you can use the home page, Congress, elections, or the directory, finish this
          record with your <strong>name</strong>, <strong>date of birth</strong>, <strong>party</strong>,{" "}
          <strong>home state</strong>, and <strong>congressional district</strong>. Biography fields
          are optional and you can edit everything later under Character.
        </p>
      </header>
      <CharacterForm profile={profile} variant="onboarding" />
    </div>
  );
}
