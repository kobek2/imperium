/**
 * Runs calendar automation (election phase advance, RP milestone handlers, etc.).
 *
 * Vercel Hobby allows at most one project cron per day, so `vercel.json` uses a daily schedule.
 * For more frequent ticks without upgrading Vercel, use a free external cron (e.g. cron-job.org)
 * to GET this URL with `Authorization: Bearer <CRON_SECRET>` on whatever interval you want.
 */
import { tickCalendarEvents } from "@/lib/calendar-event-engine";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization")?.trim();
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createServiceRoleSupabase();
  if (!supabase) {
    return new Response("Missing Supabase service role configuration", { status: 500 });
  }

  await tickCalendarEvents(supabase);
  return Response.json({ ok: true });
}
