import type { SupabaseClient } from "@supabase/supabase-js";
import { electionSeatLabel } from "@/lib/election-seat-label";

/** Dormant seat templates where at least one profile lives in that ward, district, or state. */
export type DormantOpenCandidate = {
  electionId: string;
  office: "mayor" | "council_ward" | "house" | "senate";
  /** Short label for lists */
  label: string;
  residentCount: number;
};

/**
 * Lists dormant races where at least one profile matches the jurisdiction.
 * City: council ward uses home_district_code; mayor uses any NYC (MB) resident.
 */
export async function loadDormantOpenCandidates(
  supabase: SupabaseClient,
): Promise<DormantOpenCandidate[]> {
  const [{ data: dormant, error: dErr }, { data: profs, error: pErr }] = await Promise.all([
    supabase
      .from("elections")
      .select("id, office, state, district_code, ward_code, senate_class")
      .eq("phase", "filing")
      .is("filing_window_started_at", null)
      .is("leadership_role", null)
      .in("office", ["mayor", "council_ward", "house", "senate"]),
    supabase.from("profiles").select("home_district_code, residence_state"),
  ]);

  if (dErr) throw new Error(dErr.message);
  if (pErr) throw new Error(pErr.message);

  const wardCounts = new Map<string, number>();
  const districtCounts = new Map<string, number>();
  const stateCounts = new Map<string, number>();
  let nycResidents = 0;

  for (const p of profs ?? []) {
    const rawH = p.home_district_code != null ? String(p.home_district_code).trim() : "";
    if (rawH) {
      const hd = rawH.toUpperCase();
      wardCounts.set(hd, (wardCounts.get(hd) ?? 0) + 1);
      districtCounts.set(hd, (districtCounts.get(hd) ?? 0) + 1);
    }
    const rawS = p.residence_state != null ? String(p.residence_state).trim() : "";
    if (rawS) {
      const rs = rawS.toUpperCase();
      stateCounts.set(rs, (stateCounts.get(rs) ?? 0) + 1);
      if (rs === "MB") nycResidents += 1;
    }
  }

  const out: DormantOpenCandidate[] = [];
  for (const e of dormant ?? []) {
    const electionId = String((e as { id: string }).id);
    const office = e.office as string;
    let residentCount = 0;
    let label = "";

    if (office === "council_ward") {
      const code = String(e.ward_code ?? "").trim().toUpperCase();
      if (!code) continue;
      residentCount = wardCounts.get(code) ?? 0;
      label = electionSeatLabel({ office, ward_code: code, state: e.state });
    } else if (office === "mayor") {
      residentCount = nycResidents;
      label = electionSeatLabel({ office, state: e.state });
    } else if (office === "house") {
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
