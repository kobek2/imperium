import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Runs on every matched request to refresh the Supabase access-token cookie.
 *
 * Kept at `src/middleware.ts` (not project root) so Next 16 + webpack picks it up correctly.
 * The Turbopack edge bundler leaks a `__filename`/`__dirname` reference into the runtime chunk
 * which crashes with `ReferenceError: __dirname is not defined` on Vercel's edge workers, so we
 * build with `--webpack` (see package.json) to sidestep that bug.
 */
export async function middleware(request: NextRequest) {
  try {
    return await updateSession(request);
  } catch (err) {
    console.error("[middleware] unexpected failure, passing through:", err);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
