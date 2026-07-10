import {
  clampMarijuanaStanceParams,
  formatMarijuanaPolicyStatus,
  type MarijuanaStanceParams,
} from "@/lib/marijuana-ordinance-scoring";
import type { OrdinanceProposalRow } from "@/lib/city-office-data";
import type { CityPolicyStatusKind } from "@/lib/city-policies-catalog";

export function formatMarijuanaPolicyFromOrdinance(row: OrdinanceProposalRow): {
  status: string;
  kind: CityPolicyStatusKind;
} {
  const raw = row.stanceParams as Partial<MarijuanaStanceParams> | null;
  if (!raw?.legal_status) {
    return { status: "Custom ordinance", kind: "neutral" };
  }
  const p = clampMarijuanaStanceParams(raw);

  const kind: CityPolicyStatusKind =
    p.legal_status === "illegal"
      ? "no"
      : p.legal_status === "decriminalized"
        ? "partial"
        : "yes";

  return { status: formatMarijuanaPolicyStatus(p), kind };
}
