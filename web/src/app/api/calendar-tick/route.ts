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
