import type { SupabaseClient } from "@supabase/supabase-js";

/** Dormant House/Senate templates where at least one profile lives in that district or state. */
export type DormantOpenCandidate = {
  electionId: string;
  office: "house" | "senate";
  /** Short label for lists, e.g. House · CA-12 */
  label: string;
  /** Profiles whose home district (House) or residence state (Senate) matches this seat. */
  residentCount: number;
};

/**
 * Lists dormant House and Senate races where at least one profile matches the jurisdiction
 * (re-election / incumbent geography). President races are excluded — open those from the presidential admin flow.
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
      .in("office", ["house", "senate"]),
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

  const out: DormantOpenCandidate[] = [];
  for (const e of dormant ?? []) {
    const electionId = String((e as { id: string }).id);
    const office = e.office as string;
    let residentCount = 0;
    let label = "";

    if (office === "house") {
      const code = String(e.district_code ?? "").trim().toUpperCase();
      if (!code) continue;
      residentCount = districtCounts.get(code) ?? 0;
      label = `House · ${code}`;
    } else if (office === "senate") {
      const st = String(e.state ?? "").trim().toUpperCase();
      if (!st) continue;
      const cls = e.senate_class != null ? e.senate_class : "";
      residentCount = stateCounts.get(st) ?? 0;
      label = cls !== "" ? `Senate · ${st} · class ${cls}` : `Senate · ${st}`;
    } else {
      continue;
    }

    if (residentCount < 1) continue;

    out.push({
      electionId,
      office: office as DormantOpenCandidate["office"],
      label,
      residentCount,
    });
  }

  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
