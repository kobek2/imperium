import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next 16 "proxy" (formerly "middleware") — runs on every matched request to refresh the Supabase
 * access-token cookie before the app server sees it.
 *
 * Next 16 renamed `middleware.ts` to `proxy.ts` (https://nextjs.org/docs/messages/middleware-to-proxy).
 * The old file name still builds but silently misroutes in production on Vercel (every page 404s).
 */
export async function proxy(request: NextRequest) {
  try {
    return await updateSession(request);
  } catch (err) {
    console.error("[proxy] unexpected failure, passing through:", err);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
