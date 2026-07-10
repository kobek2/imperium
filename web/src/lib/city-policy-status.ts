/**
 * Resolves catalog policies against enacted ordinances.
 */

import {
  CITY_POLICY_CATALOG,
  CITY_POLICY_CATEGORIES,
  type CityPolicyCatalogEntry,
  type CityPolicyCategoryKey,
  type CityPolicyStatusKind,
} from "@/lib/city-policies-catalog";
import type { OrdinanceProposalRow } from "@/lib/city-office-data";

export type CityPolicyStatus = {
  key: string;
  category: CityPolicyCategoryKey;
  categoryLabel: string;
  categoryIcon: string;
  label: string;
  status: string;
  kind: CityPolicyStatusKind;
  isEnacted: boolean;
};

function latestEnactedByIssue(ordinances: OrdinanceProposalRow[]): Map<string, OrdinanceProposalRow> {
  const byIssue = new Map<string, OrdinanceProposalRow>();
  for (const row of ordinances) {
    if (row.status !== "enacted") continue;
    const existing = byIssue.get(row.issueKey);
    const rowTime = row.enactedAt ?? row.createdAt;
    const existingTime = existing ? (existing.enactedAt ?? existing.createdAt) : "";
    if (!existing || rowTime.localeCompare(existingTime) > 0) {
      byIssue.set(row.issueKey, row);
    }
  }
  return byIssue;
}

function resolvePolicy(
  entry: CityPolicyCatalogEntry,
  enactedByIssue: Map<string, OrdinanceProposalRow>,
): CityPolicyStatus {
  const categoryMeta = CITY_POLICY_CATEGORIES.find((c) => c.key === entry.category)!;
  const enacted = entry.ordinanceIssueKey ? enactedByIssue.get(entry.ordinanceIssueKey) : undefined;

  if (enacted && entry.formatFromOrdinance) {
    const formatted = entry.formatFromOrdinance(enacted);
    return {
      key: entry.key,
      category: entry.category,
      categoryLabel: categoryMeta.label,
      categoryIcon: categoryMeta.icon,
      label: entry.label,
      status: formatted.status,
      kind: formatted.kind,
      isEnacted: true,
    };
  }

  return {
    key: entry.key,
    category: entry.category,
    categoryLabel: categoryMeta.label,
    categoryIcon: categoryMeta.icon,
    label: entry.label,
    status: entry.defaultStatus,
    kind: entry.defaultKind,
    isEnacted: false,
  };
}

export function buildCityPolicyStatuses(ordinances: OrdinanceProposalRow[]): CityPolicyStatus[] {
  const enactedByIssue = latestEnactedByIssue(ordinances);
  return CITY_POLICY_CATALOG.map((entry) => resolvePolicy(entry, enactedByIssue));
}

export function cityPolicyStatusesByCategory(
  policies: CityPolicyStatus[],
): Map<string, { icon: string; policies: CityPolicyStatus[] }> {
  const map = new Map<string, { icon: string; policies: CityPolicyStatus[] }>();
  for (const policy of policies) {
    const existing = map.get(policy.categoryLabel);
    if (existing) {
      existing.policies.push(policy);
    } else {
      map.set(policy.categoryLabel, { icon: policy.categoryIcon, policies: [policy] });
    }
  }
  return map;
}
