import { NextResponse, type NextRequest } from "next/server";

/**
 * No-op middleware.
 *
 * We previously refreshed the Supabase access-token cookie here, but the @supabase/ssr import
 * was failing in the Vercel Edge runtime and taking down every route with MIDDLEWARE_INVOCATION_FAILED.
 *
 * Token refresh still happens — just lazily inside server components / server actions that create
 * the Supabase client via `@/lib/supabase/server`. That's enough to keep logged-in users logged in;
 * the middleware refresh was an optimization, not a correctness requirement.
 */
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
