import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";

async function createServerClientWithCookies() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          /* set from Server Component */
        }
      },
    },
  });
}

/** One Supabase server client per request (deduped across layout + pages). */
export const tryCreateClient = cache(createServerClientWithCookies);

export async function createClient() {
  const client = await tryCreateClient();
  if (!client) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return client;
}

/** One `getUser()` per request when combined with `tryCreateClient` (deduped). */
export const getServerAuth = cache(
  async (): Promise<{
    supabase: NonNullable<Awaited<ReturnType<typeof tryCreateClient>>> | null;
    user: User | null;
  }> => {
    const supabase = await tryCreateClient();
    if (!supabase) return { supabase: null, user: null };
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return { supabase, user };
  },
);
