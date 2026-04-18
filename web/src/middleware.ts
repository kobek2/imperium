import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isProfileOnboardingComplete, type ProfileOnboardingFields } from "@/lib/character-onboarding";

/**
 * Refreshes the Supabase session and gates the app until character onboarding is complete.
 * Must not throw — a failure here would 500 every route.
 */
export async function middleware(request: NextRequest) {
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
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const path = request.nextUrl.pathname;

    if (path.startsWith("/login") || path.startsWith("/auth")) {
      return supabaseResponse;
    }

    if (!user) {
      return supabaseResponse;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("character_name, date_of_birth, residence_state, home_district_code, party")
      .eq("id", user.id)
      .maybeSingle();

    const complete = isProfileOnboardingComplete(profile as ProfileOnboardingFields | null);

    if (!complete) {
      if (path.startsWith("/onboarding") || path.startsWith("/api/")) {
        return supabaseResponse;
      }
      return NextResponse.redirect(new URL("/onboarding", request.url));
    }

    if (path.startsWith("/onboarding")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  } catch (err) {
    console.error("[middleware] failed, passing through:", err);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
