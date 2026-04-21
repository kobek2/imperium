import type { SupabaseClient } from "@supabase/supabase-js";

/** Dormant seat template races where the jurisdiction already has at least one player (for admin open-filing UI). */
export type DormantOpenCandidate = {
  electionId: string;
  office: "house" | "senate" | "president";
  /** Short label for lists, e.g. House · CA-12 */
  label: string;
  playerCount: number;
};

/**
 * Lists dormant House / Senate / President races whose jurisdiction has ≥1 profile,
 * so admins can open filing windows in bulk with clear context.
 */
export async function loadDormantOpenCandidates(
  supabase: SupabaseClient,
): Promise<DormantOpenCandidate[]> {
  const [{ data: dormant, error: dErr }, { data: profs, error: pErr }] = await Promise.all([
    supabase
      .from("elections")
      .select("id, office, state, district_code, senate_class")
      .eq("phase", "filing")
      .is("filing_window_started_at", null)
      .is("leadership_role", null)
      .in("office", ["house", "senate", "president"]),
    supabase.from("profiles").select("home_district_code, residence_state"),
  ]);

  if (dErr) throw new Error(dErr.message);
  if (pErr) throw new Error(pErr.message);

  const districtCounts = new Map<string, number>();
  const stateCounts = new Map<string, number>();
  for (const p of profs ?? []) {
    const rawH = p.home_district_code != null ? String(p.home_district_code).trim() : "";
    if (rawH) {
      const hd = rawH.toUpperCase();
      districtCounts.set(hd, (districtCounts.get(hd) ?? 0) + 1);
    }
    const rawS = p.residence_state != null ? String(p.residence_state).trim() : "";
    if (rawS) {
      const rs = rawS.toUpperCase();
      stateCounts.set(rs, (stateCounts.get(rs) ?? 0) + 1);
    }
  }
  const totalPlayers = profs?.length ?? 0;

  const out: DormantOpenCandidate[] = [];
  for (const e of dormant ?? []) {
    const office = e.office as string;
    let playerCount = 0;
    let label = "";

    if (office === "house") {
      const code = String(e.district_code ?? "").trim().toUpperCase();
      if (!code) continue;
      playerCount = districtCounts.get(code) ?? 0;
      label = `House · ${code}`;
    } else if (office === "senate") {
      const st = String(e.state ?? "").trim().toUpperCase();
      if (!st) continue;
      const cls = e.senate_class != null ? e.senate_class : "";
      playerCount = stateCounts.get(st) ?? 0;
      label = cls !== "" ? `Senate · ${st} · class ${cls}` : `Senate · ${st}`;
    } else if (office === "president") {
      playerCount = totalPlayers;
      label = "President";
    } else {
      continue;
    }

    if (playerCount < 1) continue;

    out.push({
      electionId: e.id as string,
      office: office as DormantOpenCandidate["office"],
      label,
      playerCount,
    });
  }

  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
