import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isBaselineDisabledPath } from "@/lib/baseline";
import { isProfileOnboardingComplete, type ProfileOnboardingFields } from "@/lib/character-onboarding";

function guidedTourRoot(step: number): string {
  if (step === 2) return "/economy";
  if (step === 3) return "/congress";
  return "/elections";
}

function isGuidedTourPathAllowed(path: string, step: number): boolean {
  if (path.startsWith("/login") || path.startsWith("/auth")) return true;
  if (path.startsWith("/character")) return true;

  if (step === 1) {
    return path === "/elections" || path.startsWith("/elections/");
  }
  if (step === 2) {
    return path === "/economy" || path.startsWith("/economy/");
  }
  if (step === 3) {
    return path === "/congress" || path.startsWith("/congress/") || path.startsWith("/bill/");
  }
  return true;
}

/**
 * Refreshes the Supabase session and gates the app until character onboarding is complete.
 * Must not throw — a failure here would 500 every route.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const path = request.nextUrl.pathname;
  if (isBaselineDisabledPath(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // Skip Supabase for anonymous login and for API routes (each handler owns auth / onboarding).
  if (path === "/login" || path.startsWith("/login/") || path.startsWith("/api/")) {
    return supabaseResponse;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
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

    if (path.startsWith("/auth")) {
      return supabaseResponse;
    }

    if (!user) {
      return supabaseResponse;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select(
        "character_name, date_of_birth, residence_state, home_district_code, party, orientation_completed_at, orientation_step",
      )
      .eq("id", user.id)
      .maybeSingle();

    const complete = isProfileOnboardingComplete(profile as ProfileOnboardingFields | null);

    if (!complete) {
      if (path.startsWith("/onboarding") || path.startsWith("/api/")) {
        return supabaseResponse;
      }
      return NextResponse.redirect(new URL("/onboarding", request.url));
    }

    const orientationDone = Boolean(
      (profile as { orientation_completed_at?: string | null } | null)?.orientation_completed_at,
    );
    const step = Number((profile as { orientation_step?: number | null } | null)?.orientation_step ?? 1);

    if (path.startsWith("/onboarding")) {
      if (!orientationDone) {
        return NextResponse.redirect(new URL(guidedTourRoot(step), request.url));
      }
      return NextResponse.redirect(new URL("/", request.url));
    }

    if (!orientationDone) {
      if (path.startsWith("/welcome")) {
        return NextResponse.redirect(new URL(guidedTourRoot(step), request.url));
      }
      if (!isGuidedTourPathAllowed(path, step)) {
        return NextResponse.redirect(new URL(guidedTourRoot(step), request.url));
      }
    }
  } catch (err) {
    console.error("[proxy] failed, passing through:", err);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
