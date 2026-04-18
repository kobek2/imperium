import { type NextRequest, NextResponse } from "next/server";
// Relative import — the `@/*` path alias doesn't resolve inside Vercel's Edge runtime bundle.
import { updateSession } from "./src/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  try {
    return await updateSession(request);
  } catch (err) {
    // Final safety net: never let middleware 500 the whole site. Worst case, a user sees the page
    // logged out and can re-auth via /login.
    console.error("[middleware] unexpected failure, passing through:", err);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    /**
     * Skip:
     *   - _next/static (build artifacts)
     *   - _next/image (image optimizer)
     *   - favicon and common static files
     *   - /auth/callback (Supabase OAuth finish — must run untouched so cookies land correctly)
     */
    "/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
