/**
 * Full city policy ledger — baseline city law plus ordinance-linked overrides.
 */

import { formatPropertyTaxRateDelta, type PropertyTaxStanceParams } from "@/lib/city-ordinance-scoring";
import { formatParametricOrdinanceStatus } from "@/lib/city-ordinance-param-score";
import { formatMarijuanaPolicyFromOrdinance } from "@/lib/marijuana-policy-display";
import { formatPolicingPolicyStatus } from "@/lib/policing-community-programs-scoring";
import type { OrdinanceProposalRow } from "@/lib/city-office-data";

export type CityPolicyCategoryKey =
  | "taxes"
  | "crime"
  | "economy"
  | "education"
  | "housing"
  | "health"
  | "environment";

export type CityPolicyStatusKind = "yes" | "no" | "partial" | "neutral";

export type CityPolicyCatalogEntry = {
  key: string;
  category: CityPolicyCategoryKey;
  label: string;
  defaultStatus: string;
  defaultKind: CityPolicyStatusKind;
  /** When set, latest enacted ordinance for this issue overrides the default. */
  ordinanceIssueKey?: string;
  formatFromOrdinance?: (row: OrdinanceProposalRow) => { status: string; kind: CityPolicyStatusKind };
};

export const CITY_POLICY_CATEGORIES: {
  key: CityPolicyCategoryKey;
  label: string;
  icon: string;
}[] = [
  { key: "taxes", label: "Taxes & revenue", icon: "💰" },
  { key: "crime", label: "Public safety & justice", icon: "🚔" },
  { key: "economy", label: "Economy & labor", icon: "🏪" },
  { key: "education", label: "Education", icon: "🎓" },
  { key: "housing", label: "Housing", icon: "🏠" },
  { key: "health", label: "Health & social services", icon: "🏥" },
  { key: "environment", label: "Environment & transit", icon: "🌿" },
];

function parametricOrdinanceStatus(row: OrdinanceProposalRow): { status: string; kind: CityPolicyStatusKind } {
  const params = (row.stanceParams ?? {}) as Record<string, unknown>;
  const status =
    formatParametricOrdinanceStatus(row.issueKey, params) ??
    ordinanceStanceLabel(row.category, row.issueKey, row.stanceKey, row.stanceParams);
  return { status, kind: "neutral" };
}

function stance(
  row: OrdinanceProposalRow,
  progressive: { status: string; kind: CityPolicyStatusKind },
  moderate: { status: string; kind: CityPolicyStatusKind },
  conservative: { status: string; kind: CityPolicyStatusKind },
): { status: string; kind: CityPolicyStatusKind } {
  const key = (row.stanceKey ?? "").toLowerCase();
  if (key === "progressive") return progressive;
  if (key === "moderate") return moderate;
  if (key === "conservative") return conservative;
  return { status: ordinanceStanceLabel(row.category, row.issueKey, row.stanceKey, row.stanceParams), kind: "neutral" };
}

/** Every trackable city policy — ordinance-linked rows update when the mayor signs law. */
export const CITY_POLICY_CATALOG: CityPolicyCatalogEntry[] = [
  // Taxes & revenue
  {
    key: "property_tax",
    category: "taxes",
    label: "Property tax rate",
    defaultStatus: "Set via city budget",
    defaultKind: "neutral",
    ordinanceIssueKey: "property_tax_rate",
    formatFromOrdinance: (row) => {
      const params = row.stanceParams as PropertyTaxStanceParams | null;
      if (!params) {
        return { status: "Adjusted by council ordinance", kind: "neutral" as const };
      }
      const rateLabel = formatPropertyTaxRateDelta(params.rate_delta ?? 0);
      return {
        status: `${rateLabel} · ${Math.round(params.earmark_services_pct ?? 50)}% services earmark`,
        kind:
          (params.rate_delta ?? 0) > 0.05
            ? "partial"
            : (params.rate_delta ?? 0) < -0.05
              ? "yes"
              : "neutral",
      };
    },
  },
  {
    key: "city_income_tax",
    category: "taxes",
    label: "City income tax",
    defaultStatus: "Not collected",
    defaultKind: "no",
  },
  {
    key: "business_tax",
    category: "taxes",
    label: "Local business tax",
    defaultStatus: "Standard rate",
    defaultKind: "neutral",
  },
  {
    key: "local_sales_tax",
    category: "taxes",
    label: "Local sales tax",
    defaultStatus: "None — state collects",
    defaultKind: "no",
    ordinanceIssueKey: "sales_tax_rate",
    formatFromOrdinance: (row) => {
      const params = (row.stanceParams ?? {}) as Record<string, unknown>;
      const rate = Number(params.rate ?? 0);
      return {
        status: parametricOrdinanceStatus(row).status,
        kind: rate > 0 ? "yes" : "no",
      };
    },
  },
  {
    key: "commercial_rent_tax",
    category: "taxes",
    label: "Commercial rent tax",
    defaultStatus: "In effect (Manhattan south of 96th)",
    defaultKind: "yes",
  },

  // Public safety & justice
  {
    key: "marijuana",
    category: "crime",
    label: "Marijuana legalization",
    defaultStatus: "Recreational — legal (state law)",
    defaultKind: "yes",
    ordinanceIssueKey: "marijuana_legalization",
    formatFromOrdinance: formatMarijuanaPolicyFromOrdinance,
  },
  {
    key: "community_policing",
    category: "crime",
    label: "Community policing programs",
    defaultStatus: "Standard staffing",
    defaultKind: "neutral",
    ordinanceIssueKey: "policing_community_programs",
    formatFromOrdinance: (row) => {
      if (row.stanceParams && "strategy" in row.stanceParams) {
        const status = formatPolicingPolicyStatus(row.stanceParams);
        const strategy = String(row.stanceParams.strategy ?? "balanced");
        const kind: CityPolicyStatusKind =
          strategy === "community_outreach"
            ? "yes"
            : strategy === "enforcement_heavy"
              ? "partial"
              : "neutral";
        return { status, kind };
      }
      return stance(
        row,
        { status: "Expanded", kind: "yes" },
        { status: "Standard", kind: "neutral" },
        { status: "Enforcement-first", kind: "partial" },
      );
    },
  },
  {
    key: "cash_bail_reform",
    category: "crime",
    label: "Cash bail reform",
    defaultStatus: "Limited — state standard",
    defaultKind: "partial",
    ordinanceIssueKey: "sentencing_bail_reform",
    formatFromOrdinance: (row) => {
      if (row.stanceParams && "cash_bail" in row.stanceParams) {
        const noBail = Boolean(row.stanceParams.cash_bail);
        return {
          status: parametricOrdinanceStatus(row).status,
          kind: noBail ? "yes" : "partial",
        };
      }
      return { status: "Limited — state standard", kind: "partial" };
    },
  },
  {
    key: "surveillance_policing",
    category: "crime",
    label: "Public surveillance & policing tech",
    defaultStatus: "Limited — pilot cameras",
    defaultKind: "partial",
    ordinanceIssueKey: "surveillance_policing_technology",
    formatFromOrdinance: parametricOrdinanceStatus,
  },
  {
    key: "sanctuary_city",
    category: "crime",
    label: "Sanctuary city policy",
    defaultStatus: "Yes — limited cooperation with ICE",
    defaultKind: "yes",
  },
  {
    key: "gun_control",
    category: "crime",
    label: "Local gun restrictions",
    defaultStatus: "Strict — state preemption applies",
    defaultKind: "yes",
  },

  // Economy & labor
  {
    key: "minimum_wage",
    category: "economy",
    label: "City minimum wage ($20+)",
    defaultStatus: "No — $15/hr floor",
    defaultKind: "no",
    ordinanceIssueKey: "minimum_wage",
    formatFromOrdinance: (row) => {
      if (row.stanceParams && "wage_floor" in row.stanceParams) {
        const wage = Number(row.stanceParams.wage_floor ?? 15);
        return {
          status: parametricOrdinanceStatus(row).status,
          kind: wage >= 20 ? "yes" : wage > 15 ? "partial" : "no",
        };
      }
      return { status: "No — $15/hr floor", kind: "no" };
    },
  },
  {
    key: "business_permits",
    category: "economy",
    label: "Business permit streamlining",
    defaultStatus: "Standard review",
    defaultKind: "neutral",
    ordinanceIssueKey: "small_business_permits",
    formatFromOrdinance: (row) =>
      stance(
        row,
        { status: "Yes — streamlined", kind: "yes" },
        { status: "Partial — digital filing", kind: "partial" },
        { status: "No — stricter review", kind: "no" },
      ),
  },
  {
    key: "paid_sick_leave",
    category: "economy",
    label: "Paid sick leave mandate",
    defaultStatus: "Yes — all employers",
    defaultKind: "yes",
  },
  {
    key: "commercial_rent_control",
    category: "economy",
    label: "Commercial rent control",
    defaultStatus: "No",
    defaultKind: "no",
  },
  {
    key: "rideshare_cap",
    category: "economy",
    label: "Rideshare vehicle cap",
    defaultStatus: "No cap",
    defaultKind: "no",
  },
  {
    key: "small_business_tax_incentives",
    category: "economy",
    label: "Small business tax incentives",
    defaultStatus: "None",
    defaultKind: "no",
    ordinanceIssueKey: "small_business_tax_incentives",
    formatFromOrdinance: (row) => {
      const params = (row.stanceParams ?? {}) as Record<string, unknown>;
      const credit = Number(params.tax_credit_pct ?? 0);
      return {
        status: parametricOrdinanceStatus(row).status,
        kind: credit >= 10 ? "yes" : credit > 0 ? "partial" : "no",
      };
    },
  },

  // Education
  {
    key: "free_school_lunches",
    category: "education",
    label: "Free school lunches (universal)",
    defaultStatus: "Yes — all public schools",
    defaultKind: "yes",
  },
  {
    key: "school_funding",
    category: "education",
    label: "School funding expansion",
    defaultStatus: "No — standard per-pupil",
    defaultKind: "no",
    ordinanceIssueKey: "school_funding",
    formatFromOrdinance: (row) => {
      const params = (row.stanceParams ?? {}) as Record<string, unknown>;
      const delta = Number(params.funding_delta ?? 0);
      return {
        status: parametricOrdinanceStatus(row).status,
        kind: delta >= 5 ? "yes" : delta > 0 ? "partial" : delta < 0 ? "no" : "neutral",
      };
    },
  },
  {
    key: "universal_pre_k",
    category: "education",
    label: "Universal pre-K",
    defaultStatus: "Yes — citywide",
    defaultKind: "yes",
  },
  {
    key: "charter_school_cap",
    category: "education",
    label: "Charter school cap",
    defaultStatus: "No — state charter law",
    defaultKind: "no",
    ordinanceIssueKey: "charter_school_expansion",
    formatFromOrdinance: (row) => {
      const params = (row.stanceParams ?? {}) as Record<string, unknown>;
      const delta = Number(params.charter_cap_change ?? 0);
      return {
        status: parametricOrdinanceStatus(row).status,
        kind: delta > 10 ? "yes" : delta < -10 ? "no" : "partial",
      };
    },
  },
  {
    key: "teacher_pay_class_size",
    category: "education",
    label: "Teacher pay & class size",
    defaultStatus: "Standard UFT contract",
    defaultKind: "neutral",
    ordinanceIssueKey: "teacher_pay_class_size",
    formatFromOrdinance: parametricOrdinanceStatus,
  },
  {
    key: "school_police",
    category: "education",
    label: "School safety officers in buildings",
    defaultStatus: "Yes — NYPD detail",
    defaultKind: "yes",
  },

  // Housing
  {
    key: "rent_stabilization",
    category: "housing",
    label: "Rent stabilization",
    defaultStatus: "Yes — state/local code",
    defaultKind: "yes",
  },
  {
    key: "rent_control_housing",
    category: "housing",
    label: "Rent increase cap & affordability mandate",
    defaultStatus: "State rent stabilization only",
    defaultKind: "partial",
    ordinanceIssueKey: "rent_control_housing",
    formatFromOrdinance: parametricOrdinanceStatus,
  },
  {
    key: "affordable_housing_mandate",
    category: "housing",
    label: "Mandatory affordable set-asides",
    defaultStatus: "Yes — MIH/ZQA rules",
    defaultKind: "yes",
  },
  {
    key: "tenant_right_to_counsel",
    category: "housing",
    label: "Tenant right to counsel (eviction)",
    defaultStatus: "Yes — income-eligible tenants",
    defaultKind: "yes",
  },
  {
    key: "vacancy_tax",
    category: "housing",
    label: "Vacant apartment penalty tax",
    defaultStatus: "No",
    defaultKind: "no",
  },

  // Health & social services
  {
    key: "municipal_health_clinics",
    category: "health",
    label: "Municipal health clinics",
    defaultStatus: "Yes — H+H network",
    defaultKind: "yes",
  },
  {
    key: "mental_health_crisis_teams",
    category: "health",
    label: "Mental health crisis response (non-police)",
    defaultStatus: "Partial — B-HEARD pilot",
    defaultKind: "partial",
  },
  {
    key: "homeless_shelter_right",
    category: "health",
    label: "Right to shelter",
    defaultStatus: "Yes — court mandate",
    defaultKind: "yes",
  },
  {
    key: "drug_consumption_sites",
    category: "health",
    label: "Supervised consumption sites",
    defaultStatus: "No",
    defaultKind: "no",
  },

  // Environment & transit
  {
    key: "congestion_pricing",
    category: "environment",
    label: "Congestion pricing (Manhattan core)",
    defaultStatus: "Yes — MTA program",
    defaultKind: "yes",
  },
  {
    key: "plastic_bag_ban",
    category: "environment",
    label: "Plastic bag ban",
    defaultStatus: "Yes — enforced",
    defaultKind: "yes",
  },
  {
    key: "carbon_neutral_2030",
    category: "environment",
    label: "Carbon neutral by 2030 target",
    defaultStatus: "Yes — Local Law 97",
    defaultKind: "yes",
  },
  {
    key: "bus_lane_camera_enforcement",
    category: "environment",
    label: "Bus lane camera enforcement",
    defaultStatus: "Yes — automated",
    defaultKind: "yes",
  },
  {
    key: "public_transit_investment",
    category: "environment",
    label: "City transit subsidy & fares",
    defaultStatus: "Baseline MTA partnership",
    defaultKind: "neutral",
    ordinanceIssueKey: "public_transit_investment",
    formatFromOrdinance: parametricOrdinanceStatus,
  },
  {
    key: "gas_hookup_ban",
    category: "environment",
    label: "New gas hookup ban",
    defaultStatus: "Partial — new construction rules",
    defaultKind: "partial",
  },
];
