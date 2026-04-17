"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOut() {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push("/login");
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)] underline-offset-4 hover:text-[var(--psc-ink)] hover:underline"
    >
      Sign out
    </button>
  );
}
