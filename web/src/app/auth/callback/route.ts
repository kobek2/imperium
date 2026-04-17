import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pickDiscordUsername } from "@/lib/discord-username";

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
      if (user) {
        const meta = user.user_metadata as Record<string, unknown> | undefined;
        const idData = user.identities?.[0]?.identity_data as Record<string, unknown> | undefined;
        const username = pickDiscordUsername(meta) ?? pickDiscordUsername(idData);
        if (username) {
          await supabase.from("profiles").update({ discord_username: username }).eq("id", user.id);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
