import type { SupabaseClient } from "@supabase/supabase-js";
import { NYC_COUNCIL_DISTRICT_CODES } from "@/lib/city";
import type { DirectoryHolder } from "@/lib/directory-types";
import {
  simPoliticianDirectoryId,
  type SimPoliticianRow,
} from "@/lib/sim-politicians-roster";

export type { SimPoliticianRow };

const SIM_POLITICIAN_SELECT =
  "id, slug, character_name, party, bio, face_claim_url, office, district_code, state_code, senate_class, ward_code" as const;

function toDirectoryHolder(p: SimPoliticianRow): DirectoryHolder {
  return {
    id: simPoliticianDirectoryId(p.id),
    character_name: p.character_name,
    discord_username: null,
    party: p.party,
    bio: p.bio,
    face_claim_url: p.face_claim_url,
    residence_state: p.office === "mayor" || p.office === "department_head" ? "MB" : p.state_code,
    home_district_code: p.ward_code ?? p.district_code,
    isPlaceholder: false,
  };
}

export async function loadSimPoliticians(
  supabase: SupabaseClient,
): Promise<SimPoliticianRow[]> {
  const { data, error } = await supabase
    .from("sim_politicians")
    .select(SIM_POLITICIAN_SELECT)
    .order("office", { ascending: true })
    .order("district_code", { ascending: true, nullsFirst: false })
    .order("state_code", { ascending: true, nullsFirst: false })
    .order("senate_class", { ascending: true, nullsFirst: false })
    .order("party", { ascending: true });

  if (error) {
    console.warn("[sim-politicians] load:", error.message);
    return [];
  }
  return (data ?? []) as SimPoliticianRow[];
}

export async function loadSimPoliticianById(
  supabase: SupabaseClient,
  id: string,
): Promise<SimPoliticianRow | null> {
  const { data, error } = await supabase
    .from("sim_politicians")
    .select(SIM_POLITICIAN_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.warn("[sim-politicians] loadById:", error.message);
    return null;
  }
  return (data as SimPoliticianRow | null) ?? null;
}

/** Seated House members from the roster (one per district with an incumbent politician). */
export async function loadSeatedHousePoliticians(
  supabase: SupabaseClient,
): Promise<DirectoryHolder[]> {
  const { data: districts, error: dErr } = await supabase
    .from("districts")
    .select("code, incumbent_politician_id")
    .not("incumbent_politician_id", "is", null)
    .order("code");

  if (dErr) {
    console.warn("[sim-politicians] seated house districts:", dErr.message);
    return [];
  }

  const ids = [
    ...new Set(
      (districts ?? [])
        .map((d) => (d as { incumbent_politician_id: string | null }).incumbent_politician_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (!ids.length) return [];

  const { data: politicians, error: pErr } = await supabase
    .from("sim_politicians")
    .select(SIM_POLITICIAN_SELECT)
    .in("id", ids);

  if (pErr) {
    console.warn("[sim-politicians] seated house politicians:", pErr.message);
    return [];
  }

  const byId = new Map(
    ((politicians ?? []) as SimPoliticianRow[]).map((p) => [p.id, toDirectoryHolder(p)]),
  );
  const out: DirectoryHolder[] = [];
  for (const d of districts ?? []) {
    const id = (d as { incumbent_politician_id: string }).incumbent_politician_id;
    const holder = byId.get(id);
    if (holder) out.push(holder);
  }
  return out;
}

/** Seated Senate members from senate_seats roster links. */
export async function loadSeatedSenatePoliticians(
  supabase: SupabaseClient,
): Promise<DirectoryHolder[]> {
  const { data: seats, error: sErr } = await supabase
    .from("senate_seats")
    .select("state_code, senate_class, incumbent_politician_id")
    .not("incumbent_politician_id", "is", null)
    .order("state_code")
    .order("senate_class");

  if (sErr) {
    console.warn("[sim-politicians] seated senate seats:", sErr.message);
    return [];
  }

  const ids = [
    ...new Set(
      (seats ?? [])
        .map((s) => (s as { incumbent_politician_id: string | null }).incumbent_politician_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (!ids.length) return [];

  const { data: politicians, error: pErr } = await supabase
    .from("sim_politicians")
    .select(SIM_POLITICIAN_SELECT)
    .in("id", ids);

  if (pErr) {
    console.warn("[sim-politicians] seated senate politicians:", pErr.message);
    return [];
  }

  const byId = new Map(
    ((politicians ?? []) as SimPoliticianRow[]).map((p) => [p.id, toDirectoryHolder(p)]),
  );
  const out: DirectoryHolder[] = [];
  for (const seat of seats ?? []) {
    const row = seat as {
      state_code: string;
      senate_class: number;
      incumbent_politician_id: string;
    };
    const holder = byId.get(row.incumbent_politician_id);
    if (!holder) continue;
    out.push({
      ...holder,
      residence_state: row.state_code,
      senate_class: row.senate_class,
    } as DirectoryHolder & { senate_class?: number });
  }
  return out;
}

/** Seated council members from ward roster links (W01–W07). */
export async function loadSeatedCouncilPoliticians(
  supabase: SupabaseClient,
): Promise<DirectoryHolder[]> {
  const { data: wards, error: wErr } = await supabase
    .from("wards")
    .select("code, incumbent_politician_id")
    .not("incumbent_politician_id", "is", null)
    .order("code");

  if (wErr) {
    console.warn("[sim-politicians] seated council wards:", wErr.message);
    return [];
  }

  const ids = [
    ...new Set(
      (wards ?? [])
        .map((w) => (w as { incumbent_politician_id: string | null }).incumbent_politician_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (!ids.length) return [];

  const { data: politicians, error: pErr } = await supabase
    .from("sim_politicians")
    .select(SIM_POLITICIAN_SELECT)
    .in("id", ids);

  if (pErr) {
    console.warn("[sim-politicians] seated council politicians:", pErr.message);
    return [];
  }

  const byId = new Map(
    ((politicians ?? []) as SimPoliticianRow[]).map((p) => [p.id, toDirectoryHolder(p)]),
  );
  const out: DirectoryHolder[] = [];
  for (const ward of wards ?? []) {
    const row = ward as { code: string; incumbent_politician_id: string };
    const holder = byId.get(row.incumbent_politician_id);
    if (!holder) continue;
    out.push({
      ...holder,
      home_district_code: row.code,
    });
  }
  return out;
}

export function councilWardKey(h: { home_district_code: string | null }): string {
  return (h.home_district_code ?? "").trim().toUpperCase();
}

/** Player-held wards override roster incumbents; output is sorted W01–W07. */
export function mergeCouncilDirectory(
  playerHolders: DirectoryHolder[],
  rosterHolders: DirectoryHolder[],
): DirectoryHolder[] {
  const byWard = new Map<string, DirectoryHolder>();
  for (const h of rosterHolders) {
    const w = councilWardKey(h);
    if (w) byWard.set(w, h);
  }
  for (const h of playerHolders) {
    const w = councilWardKey(h);
    if (w) byWard.set(w, h);
  }
  return NYC_COUNCIL_DISTRICT_CODES.map((code) => byWard.get(code)).filter(
    (h): h is DirectoryHolder => Boolean(h),
  );
}

const DEPT_KEYS = ["finance", "police", "public_works", "parks", "planning"] as const;

/** NPC department heads appointed by the mayor (city_department_heads). */
export async function loadDepartmentHeadHolders(
  supabase: SupabaseClient,
): Promise<Map<string, DirectoryHolder>> {
  const { data, error } = await supabase
    .from("city_department_heads")
    .select(
      "department_key, sim_politician_id, sim_politicians(id, slug, character_name, party, bio, face_claim_url, office, district_code, state_code, senate_class, ward_code)",
    )
    .in("department_key", [...DEPT_KEYS]);

  if (error) {
    console.warn("[sim-politicians] department heads:", error.message);
    return new Map();
  }

  const out = new Map<string, DirectoryHolder>();
  for (const row of data ?? []) {
    const deptKey = (row as { department_key: string }).department_key;
    const raw = (row as { sim_politicians: SimPoliticianRow | SimPoliticianRow[] | null }).sim_politicians;
    const sp = (Array.isArray(raw) ? raw[0] : raw) as SimPoliticianRow | null | undefined;
    if (!sp) continue;
    out.set(`dept_${deptKey}`, toDirectoryHolder(sp));
  }
  return out;
}

/** Merge player-held seats with roster incumbents for directory / composition views. */
export function mergeSenateDirectory<T extends { residence_state: string | null }>(
  playerHolders: T[],
  rosterHolders: T[],
): T[] {
  const playerCountByState = new Map<string, number>();
  for (const h of playerHolders) {
    const st = (h.residence_state ?? "").trim().toUpperCase();
    if (!st) continue;
    playerCountByState.set(st, (playerCountByState.get(st) ?? 0) + 1);
  }

  const rosterByState = new Map<string, typeof rosterHolders>();
  for (const h of rosterHolders) {
    const st = (h.residence_state ?? "").trim().toUpperCase();
    if (!st) continue;
    const bucket = rosterByState.get(st) ?? [];
    bucket.push(h);
    rosterByState.set(st, bucket);
  }

  const supplemental: T[] = [];
  for (const [st, roster] of rosterByState) {
    const skip = playerCountByState.get(st) ?? 0;
    supplemental.push(...roster.slice(skip));
  }

  return [...playerHolders, ...supplemental];
}

export function houseSeatKey(h: { home_district_code: string | null }): string {
  return (h.home_district_code ?? "").trim().toUpperCase();
}

export function senatorSeatKey(h: DirectoryHolder): string {
  const st = (h.residence_state ?? "").trim().toUpperCase();
  const cls = (h as DirectoryHolder & { senate_class?: number | null }).senate_class;
  return cls != null ? `${st}:${cls}` : st;
}

/** Roster politicians holding cosmetic leadership roles (when no player filed). */
export async function loadSimLeadershipHolders(
  supabase: SupabaseClient,
): Promise<Map<string, DirectoryHolder>> {
  const { data: grants, error: gErr } = await supabase
    .from("sim_government_role_grants")
    .select("role_key, sim_politician_id");

  if (gErr) {
    console.warn("[sim-politicians] leadership grants:", gErr.message);
    return new Map();
  }

  const ids = [
    ...new Set(
      (grants ?? [])
        .map((g) => (g as { sim_politician_id: string }).sim_politician_id)
        .filter(Boolean),
    ),
  ];
  if (!ids.length) return new Map();

  const { data: politicians, error: pErr } = await supabase
    .from("sim_politicians")
    .select(SIM_POLITICIAN_SELECT)
    .in("id", ids);

  if (pErr) {
    console.warn("[sim-politicians] leadership politicians:", pErr.message);
    return new Map();
  }

  const byId = new Map(
    ((politicians ?? []) as SimPoliticianRow[]).map((p) => [p.id, toDirectoryHolder(p)]),
  );

  const out = new Map<string, DirectoryHolder>();
  for (const row of grants ?? []) {
    const g = row as { role_key: string; sim_politician_id: string };
    const holder = byId.get(g.sim_politician_id);
    if (holder) out.set(g.role_key, holder);
  }
  return out;
}
