/**
 * Calendar automation disabled in simplified sim (admin-driven elections only).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization")?.trim();
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json({ ok: true, skipped: "calendar_disabled" });
}
