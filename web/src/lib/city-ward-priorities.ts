/**
 * Ward-level department priorities derived from council caucus / election platform data.
 */

import type { CityFiscalDepartmentKey } from "@/lib/city-fiscal-data";
import {
  CITY_DEPARTMENT_KEYS,
  ISSUE_DEPARTMENT_WEIGHTS,
} from "@/lib/city-department-budget";

export type WardCaucusProfile = {
  wardCode: string;
  party: "democrat" | "republican" | string;
  ideologyEconomic: number;
  ideologySocial: number;
  ideologyPragmatism: number;
  featuredIssues: string[];
};

function emptyDeptWeights(): Record<CityFiscalDepartmentKey, number> {
  return {
    finance: 0,
    police: 0,
    public_works: 0,
    parks: 0,
    planning: 0,
  };
}

/** Normalize ideology + featured issues into department priority weights (sum ≈ 1). */
export function departmentPrioritiesFromProfile(profile: WardCaucusProfile): Record<CityFiscalDepartmentKey, number> {
  const weights = emptyDeptWeights();

  for (const issue of profile.featuredIssues) {
    const key = issue.toLowerCase().trim();
    const patch = ISSUE_DEPARTMENT_WEIGHTS[key];
    if (!patch) continue;
    for (const dept of CITY_DEPARTMENT_KEYS) {
      weights[dept] += patch[dept] ?? 0;
    }
  }

  // Ideology priors when issue data is thin.
  if (profile.ideologySocial >= 15) {
    weights.parks += 0.2;
    weights.public_works += 0.1;
  } else if (profile.ideologySocial <= -10) {
    weights.police += 0.2;
    weights.finance += 0.1;
  }

  if (profile.ideologyEconomic >= 15) {
    weights.planning += 0.15;
    weights.finance += 0.1;
  } else if (profile.ideologyEconomic <= -10) {
    weights.public_works += 0.15;
    weights.parks += 0.1;
  }

  if (profile.party === "republican") {
    weights.police += 0.08;
    weights.finance += 0.06;
  } else if (profile.party === "democrat") {
    weights.parks += 0.08;
    weights.public_works += 0.06;
  }

  const sum = CITY_DEPARTMENT_KEYS.reduce((s, k) => s + weights[k], 0);
  if (sum <= 0) {
    return {
      finance: 0.15,
      police: 0.25,
      public_works: 0.25,
      parks: 0.2,
      planning: 0.15,
    };
  }

  const out = emptyDeptWeights();
  for (const dept of CITY_DEPARTMENT_KEYS) {
    out[dept] = weights[dept] / sum;
  }
  return out;
}

export function aggregateWardDepartmentPriorities(
  profiles: WardCaucusProfile[],
): Record<string, Record<CityFiscalDepartmentKey, number>> {
  const out: Record<string, Record<CityFiscalDepartmentKey, number>> = {};
  for (const profile of profiles) {
    const code = profile.wardCode.trim().toUpperCase();
    out[code] = departmentPrioritiesFromProfile(profile);
  }
  return out;
}
