import { NextResponse } from "next/server";
import { SIM_REGION_CODES } from "@/lib/regions";
import { tryCreateClient } from "@/lib/supabase/server";

const REGION_SET = new Set<string>(SIM_REGION_CODES);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state")?.trim().toUpperCase() ?? "";
  const regionFilter = REGION_SET.has(state) ? state : null;

  const supabase = await tryCreateClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("districts")
    .select("code, district_number, pvi, incumbent_party, incumbent_npc_name, claimed_by")
    .in("state", ["NE", "SO", "WE"])
    .order("district_number", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const filtered = (data ?? []).filter((d) =>
    /^(NE|SO|WE)-\d{2}$/.test(String((d as { code?: string }).code ?? "").toUpperCase()),
  );
  const districts = regionFilter
    ? filtered.filter((d) => String((d as { code?: string }).code ?? "").toUpperCase().startsWith(`${regionFilter}-`))
    : filtered;

  return NextResponse.json({ districts });
}
