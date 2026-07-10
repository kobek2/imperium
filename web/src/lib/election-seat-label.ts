import {
  councilDistrictLabel,
  isCityElectionOffice,
  NYC_CITY_NAME,
} from "@/lib/city";
import { leadershipRoleLabel, type LeadershipRole } from "@/lib/leadership";

export type ElectionSeatFields = {
  office: string;
  state?: string | null;
  district_code?: string | null;
  ward_code?: string | null;
  senate_class?: number | null;
  leadership_role?: string | null;
  restricted_party?: string | null;
};

export function electionOfficeLabel(office: string): string {
  switch (office) {
    case "mayor":
      return "Mayor";
    case "council_ward":
      return "City Council";
    case "house":
      return "U.S. House";
    case "senate":
      return "U.S. Senate";
    case "president":
      return "President";
    default:
      return office.replace(/_/g, " ");
  }
}

export function electionSeatLabel(e: ElectionSeatFields): string {
  if (e.leadership_role) {
    const label = leadershipRoleLabel(e.leadership_role as LeadershipRole);
    return e.restricted_party ? `${label} · ${e.restricted_party}` : label;
  }
  if (e.office === "president") return "Nationwide";
  if (isCityElectionOffice(e.office)) {
    if (e.office === "mayor") return `Mayor · ${NYC_CITY_NAME}`;
    if (e.office === "council_ward" && e.ward_code) {
      return councilDistrictLabel(e.ward_code);
    }
    return NYC_CITY_NAME;
  }
  if (e.office === "senate") {
    const cls = e.senate_class ? ` · C${e.senate_class}` : "";
    return `${e.state ?? "—"}${cls}`;
  }
  return e.district_code ?? e.state ?? "—";
}

export function electionSeatSearchBlob(e: ElectionSeatFields): string {
  return [
    e.office,
    e.state ?? "",
    e.district_code ?? "",
    e.ward_code ?? "",
    e.senate_class ? `class ${e.senate_class}` : "",
    e.leadership_role ?? "",
    e.restricted_party ?? "",
    electionSeatLabel(e),
  ]
    .join(" ")
    .toLowerCase();
}
