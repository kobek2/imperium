import {
  type BillTemplateDefinition,
  type BillTemplateStance,
} from "@/lib/bill-templates-registry";

export type { BillTemplateDefinition, BillTemplateStance };

/** Moderate city ordinance templates for Millbrook council sessions. */
export const MILLBROOK_BILL_TEMPLATE_REGISTRY: BillTemplateDefinition[] = [
  {
    issue_key: "zoning_infill",
    display_name: "Zoning & Infill",
    description: "How aggressively Millbrook allows duplexes and mixed-use near transit corridors.",
    stances: [
      { stance_key: "status_quo", label: "Status quo", summary: "Keep single-family buffers; pilot infill on arterial corridors only.", full_text: "", policy_value: 0 },
      { stance_key: "moderate_upzone", label: "Moderate upzone", summary: "Allow missing-middle housing within ½ mile of bus lines.", full_text: "", policy_value: 1 },
      { stance_key: "bold_upzone", label: "Bold upzone", summary: "Citywide allowance for fourplexes by-right on residential lots.", full_text: "", policy_value: 2 },
    ],
  },
  {
    issue_key: "police_funding",
    display_name: "Public Safety Budget",
    description: "Police staffing levels vs. community services in the annual budget.",
    stances: [
      { stance_key: "expand_police", label: "Expand patrol", summary: "Fund 12 additional officers and overtime for weekend shifts.", full_text: "", policy_value: -1 },
      { stance_key: "hold_steady", label: "Hold steady", summary: "Maintain current authorized strength; invest in body-worn cameras.", full_text: "", policy_value: 0 },
      { stance_key: "rebalance", label: "Rebalance", summary: "Shift $2M from overtime to mental-health co-responder teams.", full_text: "", policy_value: 1 },
    ],
  },
  {
    issue_key: "parks_trails",
    display_name: "Parks & Trails",
    description: "Greenway expansion and deferred maintenance at neighborhood parks.",
    stances: [
      { stance_key: "maintenance_first", label: "Maintenance first", summary: "Clear the parks backlog before new capital projects.", full_text: "", policy_value: -1 },
      { stance_key: "balanced", label: "Balanced", summary: "Split bond proceeds 50/50 between trails and playground upgrades.", full_text: "", policy_value: 0 },
      { stance_key: "trail_push", label: "Trail push", summary: "Accelerate the Lakeside connector and downtown riverwalk phase II.", full_text: "", policy_value: 1 },
    ],
  },
  {
    issue_key: "property_tax",
    display_name: "Property Tax & Fees",
    description: "Mill levy adjustments and utility franchise fees for homeowners.",
    stances: [
      { stance_key: "cut_levy", label: "Cut levy", summary: "Reduce the general fund mill levy by 0.4 mills over two years.", full_text: "", policy_value: -2 },
      { stance_key: "flat", label: "Flat levy", summary: "Freeze the levy; fund inflation through efficiency reviews.", full_text: "", policy_value: 0 },
      { stance_key: "invest_levy", label: "Invest levy", summary: "Raise levy 0.3 mills for street resurfacing and stormwater.", full_text: "", policy_value: 1 },
    ],
  },
  {
    issue_key: "small_business",
    display_name: "Small Business Relief",
    description: "Facade grants, permit fee holidays, and vacant storefront incentives.",
    stances: [
      { stance_key: "targeted_grants", label: "Targeted grants", summary: "$500k micro-grant pool for women- and minority-owned shops.", full_text: "", policy_value: 1 },
      { stance_key: "broad_relief", label: "Broad relief", summary: "Six-month permit fee waiver for ground-floor retail citywide.", full_text: "", policy_value: 0 },
      { stance_key: "market_rates", label: "Market rates", summary: "No new subsidies; streamline inspections to cut wait times.", full_text: "", policy_value: -1 },
    ],
  },
];

const ACTIVE_BILL_REGISTRY = MILLBROOK_BILL_TEMPLATE_REGISTRY;

export function spectrumPct(policyValue: number): number {
  return Math.max(0, Math.min(100, ((policyValue + 2) / 4) * 100));
}

export function stanceSpectrumLabel(policyValue: number): string {
  if (policyValue <= -1) return "Conservative";
  if (policyValue >= 1) return "Liberal";
  return "Centrist";
}

/** Deterministic issue rotation — 4 featured issues per council turn. */
export function pickFeaturedIssues(
  cycle: number,
  turn: number,
  featuredKeys?: string[] | null,
): BillTemplateDefinition[] {
  const keys = featuredKeys?.length ? featuredKeys : null;
  if (keys) {
    const byKey = new Map(ACTIVE_BILL_REGISTRY.map((t) => [t.issue_key, t]));
    const picked = keys.map((k) => byKey.get(k)).filter(Boolean) as BillTemplateDefinition[];
    if (picked.length > 0) return picked;
  }

  const scored = ACTIVE_BILL_REGISTRY.map((t) => ({
    template: t,
    score: hashIssue(`${t.issue_key}:${cycle}:${turn}`),
  })).sort((a, b) => a.score - b.score);

  return scored.slice(0, 4).map((s) => s.template);
}

function hashIssue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function composeRoundBillTitle(template: BillTemplateDefinition, stance: BillTemplateStance): string {
  return `${template.display_name} — ${stance.label}`;
}

export function describeRoundBill(
  template: BillTemplateDefinition,
  stance: BillTemplateStance,
): { title: string; summary: string; issueKey: string; stanceKey: string; policyValue: number } {
  return {
    title: composeRoundBillTitle(template, stance),
    summary: stance.summary,
    issueKey: template.issue_key,
    stanceKey: stance.stance_key,
    policyValue: stance.policy_value,
  };
}

export function issueDisplayName(issueKey: string): string {
  return ACTIVE_BILL_REGISTRY.find((t) => t.issue_key === issueKey)?.display_name ?? issueKey;
}

export function stanceLabelForBill(bill: {
  issueKey?: string | null;
  stanceKey?: string | null;
  policyValue?: number | null;
}): string | null {
  if (!bill.issueKey || !bill.stanceKey) return null;
  const tpl = ACTIVE_BILL_REGISTRY.find((t) => t.issue_key === bill.issueKey);
  const stance = tpl?.stances.find((s) => s.stance_key === bill.stanceKey);
  return stance?.label ?? bill.stanceKey;
}
