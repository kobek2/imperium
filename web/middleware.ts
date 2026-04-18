import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./src/lib/supabase/middleware";

/**
 * Pinned to the Node runtime on purpose.
 *
 * Next 16 + Turbopack leaks a `__dirname` reference into the edge middleware bundle in this project
 * (likely interacting with the `turbopack.root` override in next.config.ts), which crashes every
 * request with MIDDLEWARE_INVOCATION_FAILED. The node runtime uses a different bundler path and
 * doesn't hit that bug. Slightly higher per-request overhead (~20ms vs edge ~5ms), but reliable.
 */
export const runtime = "nodejs";

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
