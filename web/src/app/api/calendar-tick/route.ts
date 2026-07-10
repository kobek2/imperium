import { createClient } from "@supabase/supabase-js";
import { NYC_CITY_CODE } from "@/lib/city";

/** Cron + backup: advance city real-time scheduler (elections, budget windows, salaries). */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization")?.trim();
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return Response.json({ ok: false, error: "missing_supabase_env" }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey);
  const { data, error } = await supabase.rpc("tick_city_realtime_scheduler", {
    p_city_code: NYC_CITY_CODE,
  });

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, city: data });
}
