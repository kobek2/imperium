/**
 * Baseline sim: manual elections, 3 regions, floor-only legislation, grants-based roles.
 * Routes listed here redirect home so players cannot reach disabled legacy systems.
 */

export const BASELINE_DISABLED_PATH_PREFIXES = [
  "/oval",
  "/policy",
  "/cabinet",
  "/economy/federal",
  "/economy/national-metrics",
  "/national-metrics",
  "/history",
  "/docket",
  "/inbox",
  "/admin/diplomacy",
  "/admin/court-docket",
  "/admin/leadership",
  "/admin/activity",
  "/admin/operations",
  "/admin/party-leadership",
  "/admin/economy",
  "/events",
] as const;

export function isBaselineDisabledPath(pathname: string): boolean {
  const path = pathname.split("?")[0] ?? pathname;
  return BASELINE_DISABLED_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}
