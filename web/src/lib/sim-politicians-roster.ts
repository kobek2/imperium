/** Shared types for roster politicians (DB-backed NPC officeholders). */

export type SimPoliticianOffice = "house" | "senate" | "council" | "mayor" | "department_head";

export type SimPoliticianRow = {
  id: string;
  slug: string;
  character_name: string;
  party: "democrat" | "republican";
  bio: string;
  face_claim_url: string | null;
  office: SimPoliticianOffice;
  district_code: string | null;
  state_code: string | null;
  senate_class: number | null;
  ward_code: string | null;
};

/** Prefix for directory / profile links to sim politicians. */
export const SIM_POLITICIAN_ID_PREFIX = "sim:";

export function simPoliticianDirectoryId(id: string): string {
  return `${SIM_POLITICIAN_ID_PREFIX}${id}`;
}

export function isSimPoliticianDirectoryId(id: string | null | undefined): boolean {
  return (id ?? "").startsWith(SIM_POLITICIAN_ID_PREFIX);
}

export function simPoliticianIdFromDirectoryId(id: string): string {
  return id.startsWith(SIM_POLITICIAN_ID_PREFIX) ? id.slice(SIM_POLITICIAN_ID_PREFIX.length) : id;
}

export function simPoliticianProfilePath(id: string | null | undefined): string | null {
  const raw = (id ?? "").trim();
  if (!raw) return null;
  const politicianId = isSimPoliticianDirectoryId(raw)
    ? simPoliticianIdFromDirectoryId(raw)
    : raw;
  if (!politicianId) return null;
  return `/politician/${politicianId}`;
}
