import { NextResponse } from "next/server";
import { NYC_CITY_CODE } from "@/lib/city";
import { tryCreateClient } from "@/lib/supabase/server";

/** Returns NYC council districts for character onboarding (ward codes W01–W07). */
export async function GET() {
  const supabase = await tryCreateClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("wards")
    .select("code, ward_number, name, pvi, incumbent_party, incumbent_npc_name, claimed_by")
    .eq("city_code", NYC_CITY_CODE)
    .order("ward_number", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const districts = (data ?? []).map((w) => ({
    code: String(w.code).trim().toUpperCase(),
    district_number: Number(w.ward_number),
    name: String(w.name ?? "").trim() || undefined,
    pvi: Number(w.pvi),
    incumbent_party: String(w.incumbent_party ?? ""),
    incumbent_npc_name: String(w.incumbent_npc_name ?? ""),
    claimed_by: w.claimed_by ?? null,
  }));

  return NextResponse.json({ districts });
}
