import { NextResponse } from "next/server";
import { tryCreateClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state");
  if (!state || state.length !== 2) {
    return NextResponse.json({ error: "state required" }, { status: 400 });
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("districts")
    .select("code, pvi, incumbent_party, incumbent_npc_name, claimed_by")
    .eq("state", state.toUpperCase())
    .order("district_number", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ districts: data ?? [] });
}
