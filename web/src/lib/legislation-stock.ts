import { BUSINESS_SECTORS } from "@/lib/economy-config";

export type BusinessSectorKey = (typeof BUSINESS_SECTORS)[number]["key"];

/** Map template issue keys to stock sectors when filing Change Policy bills. */
export const ISSUE_KEY_TO_SECTOR: Partial<Record<string, BusinessSectorKey>> = {
  healthcare: "healthcare",
  drug_policy: "healthcare",
  climate: "energy",
  gun_control: "defense",
  minimum_wage: "finance",
  student_debt: "finance",
  immigration: "agriculture",
};

export function sectorFromIssueKey(issueKey: string | null | undefined): BusinessSectorKey | null {
  if (!issueKey) return null;
  return ISSUE_KEY_TO_SECTOR[issueKey.toLowerCase()] ?? null;
}

/** Default stock effect from policy stance when the filer does not set one explicitly. */
export function defaultStockEffectFromPolicyTags(policyTags: Record<string, unknown> | null): number {
  if (!policyTags) return 20;
  const stance = String(policyTags.stance_key ?? "").toLowerCase();
  const policyValue = Number(policyTags.policy_value ?? 0);
  if (stance.includes("oppose") || stance.includes("restrict") || stance.includes("reduce")) return -20;
  if (policyValue < 0) return -20;
  if (policyValue === 0) return 0;
  return 20;
}

export function parseStockMarketEffect(raw: string | null | undefined): number | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.max(-100, Math.min(100, Math.round(n * 100) / 100));
}

export function formatSectorEffectPct(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct}%`;
}

export function sectorLabel(key: string | null | undefined): string {
  return BUSINESS_SECTORS.find((s) => s.key === key)?.label ?? key?.replace(/_/g, " ") ?? "—";
}

export const COMPANY_BILL_POSITIONS = [
  { key: "support", label: "Supports" },
  { key: "oppose", label: "Opposes" },
  { key: "neutral", label: "Neutral" },
] as const;

export type CompanyBillPosition = (typeof COMPANY_BILL_POSITIONS)[number]["key"];

/** Preset sector legislation measures founders can push via shareholder lobbyists. */
export const SECTOR_BILL_MEASURES = [
  {
    key: "subsidy",
    label: "Industry Subsidy & Investment",
    description: "Federal grants, loan guarantees, and procurement preference for the sector.",
    stockEffect: 25,
  },
  {
    key: "deregulation",
    label: "Regulatory Relief",
    description: "Roll back compliance burdens and expedite permitting for sector firms.",
    stockEffect: 15,
  },
  {
    key: "tax_credit",
    label: "Sector Tax Credit",
    description: "Targeted tax credits for capital investment and domestic production.",
    stockEffect: 12,
  },
  {
    key: "procurement",
    label: "Federal Procurement Mandate",
    description: "Require federal agencies to prioritize contracts with sector companies.",
    stockEffect: 20,
  },
] as const;

export type SectorBillMeasureKey = (typeof SECTOR_BILL_MEASURES)[number]["key"];

export function sectorBillMeasure(key: string | null | undefined) {
  return SECTOR_BILL_MEASURES.find((m) => m.key === key) ?? null;
}

export function buildSectorBillTitle(sectorKey: string, measureKey: string, companyName?: string): string {
  const sector = sectorLabel(sectorKey);
  const measure = sectorBillMeasure(measureKey);
  const suffix = measure?.label ?? "Industry Support Act";
  if (companyName) return `${sector} ${suffix} — ${companyName} Initiative`;
  return `${sector} ${suffix} Act`;
}

export function buildSectorBillMarkdown(
  sectorKey: string,
  measureKey: string,
  companyName: string,
  ticker: string | null,
): string {
  const sector = sectorLabel(sectorKey);
  const measure = sectorBillMeasure(measureKey);
  const effect = measure?.stockEffect ?? 15;
  const companyRef = ticker ? `${companyName} (${ticker})` : companyName;
  const title = buildSectorBillTitle(sectorKey, measureKey);

  const sections: string[] = [
    `${title}`,
    "",
    "Be it enacted by the Senate and House of Representatives of the United States of America in Congress assembled,",
    "",
    `SECTION 1. SHORT TITLE. This Act may be cited as the "${buildSectorBillTitle(sectorKey, measureKey)}".`,
    "",
    `SECTION 2. FINDINGS. Congress finds that the ${sector.toLowerCase()} industry is vital to national economic security, and that firms such as ${companyRef} require supportive federal policy to remain globally competitive.`,
    "",
    `SECTION 3. SECTOR POLICY. The Secretary of Commerce shall implement measures benefiting the ${sector.toLowerCase()} sector, including programs consistent with a ${effect}% improvement in sector market conditions upon enactment.`,
    "",
    "SECTION 4. REPORTING. Within 180 days, the Secretary shall report to Congress on disbursements, regulatory actions, and market outcomes attributable to this Act.",
    "",
    "SECTION 5. SEVERABILITY. If any provision of this Act is held invalid, the remainder shall continue in effect.",
    "",
    "SECTION 6. EFFECTIVE DATE. This Act takes effect on the date of enactment.",
  ];

  if (measureKey === "subsidy") {
    sections.splice(
      7,
      0,
      `SECTION 3A. GRANTS. The Secretary may award competitive grants to qualified ${sector.toLowerCase()} companies, including strategic suppliers identified in consultation with industry leaders.`,
    );
  } else if (measureKey === "deregulation") {
    sections.splice(
      7,
      0,
      `SECTION 3A. REGULATORY REVIEW. Each federal agency shall review rules affecting the ${sector.toLowerCase()} sector and suspend or amend rules that impose undue compliance costs.`,
    );
  } else if (measureKey === "tax_credit") {
    sections.splice(
      7,
      0,
      `SECTION 3A. TAX CREDITS. A refundable tax credit shall be available for qualified capital expenditures by ${sector.toLowerCase()} firms engaged in domestic production.`,
    );
  } else if (measureKey === "procurement") {
    sections.splice(
      7,
      0,
      `SECTION 3A. PROCUREMENT. Federal agencies shall give preference to ${sector.toLowerCase()} contractors that meet domestic-content thresholds established by the Secretary.`,
    );
  }

  return sections.join("\n");
}
