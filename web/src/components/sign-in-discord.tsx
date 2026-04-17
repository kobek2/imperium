"use client";

import { createClient } from "@/lib/supabase/client";

export function SignInDiscord() {
  async function signIn() {
    const supabase = createClient();
    const origin = window.location.origin;
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: `${origin}/auth/callback`,
      },
    });
  }

  return (
    <button
      type="button"
      onClick={() => void signIn()}
      className="w-full border border-[var(--psc-border)] bg-[var(--psc-ink)] px-4 py-3 text-sm font-semibold uppercase tracking-wide text-white transition hover:opacity-90"
    >
      Continue with Discord
    </button>
  );
}
