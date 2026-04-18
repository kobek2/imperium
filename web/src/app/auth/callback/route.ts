import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pickDiscordUsername } from "@/lib/discord-username";
import { isProfileOnboardingComplete, type ProfileOnboardingFields } from "@/lib/character-onboarding";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    let supabase;
    try {
      supabase = await createClient();
    } catch {
      return NextResponse.redirect(`${origin}/login?error=config`);
    }
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      let destination = next;
      if (user) {
        const meta = user.user_metadata as Record<string, unknown> | undefined;
        const idData = user.identities?.[0]?.identity_data as Record<string, unknown> | undefined;
        const username = pickDiscordUsername(meta) ?? pickDiscordUsername(idData);
        const [{ data: profile }] = await Promise.all([
          supabase
            .from("profiles")
            .select("character_name, date_of_birth, residence_state, home_district_code, party")
            .eq("id", user.id)
            .maybeSingle(),
          username
            ? supabase.from("profiles").update({ discord_username: username }).eq("id", user.id)
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (
          profile &&
          !isProfileOnboardingComplete(profile as ProfileOnboardingFields) &&
          !next.startsWith("/onboarding")
        ) {
          destination = "/onboarding";
        }
      }
      return NextResponse.redirect(`${origin}${destination}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
