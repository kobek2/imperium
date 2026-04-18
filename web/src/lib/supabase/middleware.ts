import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on the edge.
 *
 * IMPORTANT: This runs on every matched request in production, so it MUST NEVER throw. If it throws
 * (bad env, network blip talking to Supabase, cookie parse glitch, incompatibility between
 * @supabase/ssr and a future Next.js), Vercel returns 500 MIDDLEWARE_INVOCATION_FAILED for every
 * route, not just the broken one. We therefore wrap the whole thing in a try/catch and fall back to
 * a pass-through response on any failure — the page will load unauthenticated rather than 500.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return supabaseResponse;
  }

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    });

    // Touch the session so @supabase/ssr can refresh the access token cookie if needed. Any error
    // here (expired refresh token, network timeout, Supabase 5xx) is non-fatal — the request
    // continues and downstream server components will simply see an unauthenticated user.
    await supabase.auth.getUser();
  } catch (err) {
    console.error("[middleware] updateSession failed, passing through:", err);
  }

  return supabaseResponse;
}
