import { type NextRequest } from "next/server";
// Use a relative import — the `@/*` path alias does not resolve reliably inside the Edge runtime
// bundle that Vercel builds for middleware, even though it works fine in app-router server files.
import { updateSession } from "./src/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
