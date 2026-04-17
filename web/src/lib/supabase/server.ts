import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

async function createServerClientWithCookies() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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

export async function tryCreateClient() {
  return createServerClientWithCookies();
}

export async function createClient() {
  const client = await createServerClientWithCookies();
  if (!client) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return client;
}
