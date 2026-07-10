/**
 * Presentation-only mapping for city policy status display.
 * Does not alter how policy status is computed from ordinances.
 */

import {
  CITY_POLICY_CATALOG,
  type CityPolicyStatusKind,
} from "@/lib/city-policies-catalog";
import type { CityPolicyStatus } from "@/lib/city-policy-status";

/** Uniform status tone applied across all categories. */
export type PolicyDisplayTone = "baseline" | "expansive" | "restrictive" | "not_applicable";

const NOT_APPLICABLE_PATTERNS = [
  /state law/i,
  /state standard/i,
  /state preemption/i,
  /state charter/i,
  /mta program/i,
  /court mandate/i,
  /not collected/i,
  /set via city budget/i,
];

const CATEGORY_SHORT_LABEL: Record<string, string> = {
  taxes: "Taxes",
  crime: "Public Safety",
  economy: "Economy",
  education: "Education",
  housing: "Housing",
  health: "Health",
  environment: "Environment",
};

function kindRank(kind: CityPolicyStatusKind): number {
  switch (kind) {
    case "no":
      return 0;
    case "partial":
      return 1;
    case "neutral":
      return 2;
    case "yes":
      return 3;
    default:
      return 2;
  }
}

function catalogEntry(key: string) {
  return CITY_POLICY_CATALOG.find((e) => e.key === key);
}

function isNotApplicableBaseline(policy: CityPolicyStatus): boolean {
  const entry = catalogEntry(policy.key);
  const text = entry?.defaultStatus ?? policy.status;
  return NOT_APPLICABLE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Maps a resolved policy row to one of four display tones. */
export function policyDisplayTone(policy: CityPolicyStatus): PolicyDisplayTone {
  if (!policy.isEnacted) {
    return isNotApplicableBaseline(policy) ? "not_applicable" : "baseline";
  }

  const entry = catalogEntry(policy.key);
  if (!entry) {
    if (policy.kind === "no") return "restrictive";
    if (policy.kind === "yes") return "expansive";
    return "baseline";
  }

  const delta = kindRank(policy.kind) - kindRank(entry.defaultKind);
  if (delta > 0) return "expansive";
  if (delta < 0) return "restrictive";
  return "baseline";
}

export function policyCategoryShortLabel(categoryKey: string): string {
  return CATEGORY_SHORT_LABEL[categoryKey] ?? categoryKey;
}

export function policyStatusPillClass(tone: PolicyDisplayTone): string {
  switch (tone) {
    case "expansive":
      return "border-emerald-400/80 bg-emerald-50 text-emerald-950";
    case "restrictive":
      return "border-amber-400/80 bg-amber-50 text-amber-950";
    case "not_applicable":
      return "border-dashed border-slate-300 bg-slate-50/50 text-slate-500";
    default:
      return "border-slate-200 bg-slate-50 text-slate-800";
  }
}

export const POLICY_TONE_LEGEND: { tone: PolicyDisplayTone; label: string }[] = [
  { tone: "baseline", label: "Baseline" },
  { tone: "expansive", label: "Changed — more permissive" },
  { tone: "restrictive", label: "Changed — more restrictive" },
  { tone: "not_applicable", label: "Not locally controlled" },
];

export const POLICY_FILTER_CATEGORIES: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "taxes", label: "Taxes" },
  { key: "crime", label: "Public Safety" },
  { key: "economy", label: "Economy" },
  { key: "education", label: "Education" },
  { key: "housing", label: "Housing" },
  { key: "health", label: "Health" },
  { key: "environment", label: "Environment" },
];
