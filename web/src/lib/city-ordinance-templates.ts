import { formatMarijuanaPolicyStatus, isMarijuanaIssue } from "@/lib/marijuana-ordinance-scoring";
import { formatParametricOrdinanceStatus } from "@/lib/city-ordinance-param-score";
import { isRegistryParametricIssue } from "@/lib/city-ordinance-param-registry";

export type OrdinanceCategory = "crime" | "economy" | "education" | "taxes";

export type OrdinanceStanceKey = "progressive" | "moderate" | "conservative";

export type OrdinanceStance = {
  key: OrdinanceStanceKey;
  label: string;
  description: string;
};

export type OrdinanceIssueTemplate =
  | {
      issueKey: string;
      title: string;
      summary: string;
      usesStanceParams: true;
    }
  | {
      issueKey: string;
      title: string;
      summary: string;
      usesStanceParams?: false;
      stances: OrdinanceStance[];
    };

export type OrdinanceCategoryMeta = {
  key: OrdinanceCategory;
  label: string;
  icon: string;
  description: string;
  issues: OrdinanceIssueTemplate[];
};

export const ORDINANCE_CATEGORIES: OrdinanceCategoryMeta[] = [
  {
    key: "crime",
    label: "Crime",
    icon: "🚔",
    description: "Public safety, justice, and policing policy.",
    issues: [
      {
        issueKey: "marijuana_legalization",
        title: "Marijuana Legalization",
        summary:
          "Sets local marijuana policy — legal status, licensed commercial sales, cannabis sales tax, and expungement.",
        usesStanceParams: true,
      },
      {
        issueKey: "policing_community_programs",
        title: "Police Staffing & Community Programs",
        summary: "Adjusts NYPD headcount and community safety grants. Set staffing change and deployment strategy.",
        usesStanceParams: true,
      },
      {
        issueKey: "sentencing_bail_reform",
        title: "Sentencing & Bail Reform",
        summary: "Sets sentencing severity and whether cash bail is eliminated for qualifying offenses.",
        usesStanceParams: true,
      },
      {
        issueKey: "surveillance_policing_technology",
        title: "Surveillance & Policing Technology",
        summary: "Authorizes public-area camera coverage and optional facial recognition on feeds.",
        usesStanceParams: true,
      },
    ],
  },
  {
    key: "economy",
    label: "Economy",
    icon: "🏪",
    description: "Labor, housing, business incentives, and transit.",
    issues: [
      {
        issueKey: "minimum_wage",
        title: "City Minimum Wage",
        summary: "Sets the municipal minimum wage floor for private employers operating in NYC.",
        usesStanceParams: true,
      },
      {
        issueKey: "rent_control_housing",
        title: "Rent Control & Housing Affordability",
        summary: "Caps annual rent increases and optional affordable unit mandates on new development.",
        usesStanceParams: true,
      },
      {
        issueKey: "small_business_tax_incentives",
        title: "Small Business Tax Incentives",
        summary: "Creates local business tax credits with eligibility tiers for small employers.",
        usesStanceParams: true,
      },
      {
        issueKey: "public_transit_investment",
        title: "Public Transit Investment",
        summary: "Adjusts city transit subsidy levels and fare changes from baseline.",
        usesStanceParams: true,
      },
    ],
  },
  {
    key: "education",
    label: "Education",
    icon: "🎓",
    description: "School funding, charters, and classroom policy.",
    issues: [
      {
        issueKey: "school_funding",
        title: "School Funding Allocation",
        summary: "Changes per-pupil funding and allocation focus across district priorities.",
        usesStanceParams: true,
      },
      {
        issueKey: "charter_school_expansion",
        title: "School Choice & Charter Expansion",
        summary: "Adjusts charter school caps and optional municipal voucher programs.",
        usesStanceParams: true,
      },
      {
        issueKey: "teacher_pay_class_size",
        title: "Teacher Pay & Class Size",
        summary: "Sets teacher pay increases and target students-per-teacher ratios.",
        usesStanceParams: true,
      },
    ],
  },
  {
    key: "taxes",
    label: "Taxes",
    icon: "💰",
    description: "Local revenue ordinances (property tax is set via the city budget).",
    issues: [
      {
        issueKey: "sales_tax_rate",
        title: "Local Sales Tax Rate",
        summary: "Sets the municipal sales tax rate. Revenue flows into city fiscal totals on enactment.",
        usesStanceParams: true,
      },
    ],
  },
];

export function ordinanceCategoryByKey(key: string): OrdinanceCategoryMeta | undefined {
  return ORDINANCE_CATEGORIES.find((c) => c.key === key);
}

export function ordinanceIssueByKey(
  categoryKey: string,
  issueKey: string,
): { category: OrdinanceCategoryMeta; issue: OrdinanceIssueTemplate } | undefined {
  const category = ordinanceCategoryByKey(categoryKey);
  if (!category) return undefined;
  const issue = category.issues.find((i) => i.issueKey === issueKey);
  if (!issue) return undefined;
  return { category, issue };
}

export function issueUsesStanceParams(issue: OrdinanceIssueTemplate): boolean {
  return issue.usesStanceParams === true;
}

export function buildOrdinanceTitle(
  categoryKey: string,
  issueKey: string,
  stanceKey: OrdinanceStanceKey,
): string {
  const found = ordinanceIssueByKey(categoryKey, issueKey);
  if (!found) return "City ordinance";
  if (issueUsesStanceParams(found.issue)) return found.issue.title;
  if (!("stances" in found.issue)) return found.issue.title;
  const stance = found.issue.stances.find((s) => s.key === stanceKey);
  return `${found.issue.title} — ${stance?.label ?? stanceKey}`;
}

export function ordinanceCategoryLabel(categoryKey: string): string {
  return ordinanceCategoryByKey(categoryKey)?.label ?? categoryKey;
}

export function ordinanceStanceLabel(
  categoryKey: string,
  issueKey: string,
  stanceKey: string | null,
  stanceParams?: Record<string, unknown> | null,
): string {
  if (isPropertyTaxIssue(issueKey) && stanceParams && "rate_delta" in stanceParams) {
    const rd = Number(stanceParams.rate_delta ?? 0);
    const earmark = Math.round(Number(stanceParams.earmark_services_pct ?? 0));
    const rate =
      Math.abs(rd) < 0.05 ? "hold steady" : `${rd > 0 ? "+" : ""}${rd.toFixed(1)} pp`;
    return `${rate}, ${earmark}% services`;
  }
  if (isMarijuanaIssue(issueKey) && stanceParams?.legal_status) {
    return formatMarijuanaPolicyStatus(stanceParams);
  }
  if (isRegistryParametricIssue(issueKey) && stanceParams) {
    return formatParametricOrdinanceStatus(issueKey, stanceParams) ?? stanceKey ?? "custom";
  }
  const found = ordinanceIssueByKey(categoryKey, issueKey);
  if (!found || issueUsesStanceParams(found.issue)) return stanceKey ?? "custom";
  if (!("stances" in found.issue)) return stanceKey ?? "custom";
  const stance = found.issue.stances.find((s) => s.key === stanceKey);
  return stance?.label ?? stanceKey ?? "unknown";
}

function isPropertyTaxIssue(issueKey: string): boolean {
  return issueKey.toLowerCase().trim() === "property_tax_rate";
}

export function buildOrdinanceSummary(
  categoryKey: string,
  issueKey: string,
  stanceKey: OrdinanceStanceKey,
): string {
  const found = ordinanceIssueByKey(categoryKey, issueKey);
  if (!found) return "";
  if (issueUsesStanceParams(found.issue)) return found.issue.summary;
  if (!("stances" in found.issue)) return found.issue.summary;
  const stance = found.issue.stances.find((s) => s.key === stanceKey);
  return `${found.issue.summary} Selected approach: ${stance?.description ?? stanceKey}.`;
}
