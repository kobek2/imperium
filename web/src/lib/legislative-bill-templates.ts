export type PolicyOption = {
  value: string;
  label: string;
  summaryClause: string;
};

export type PolicyChoice = {
  key: string;
  label: string;
  hint?: string;
  options: PolicyOption[];
};

export type LegislativeBillTemplate = {
  id: string;
  title: string;
  tagline: string;
  icon: string;
  category: string;
  baseSummary: string;
  choices: PolicyChoice[];
};

const DEMOCRAT_TEMPLATES: LegislativeBillTemplate[] = [
  {
    id: "clean-energy-jobs",
    title: "Clean Energy Jobs Act",
    tagline: "Climate investment & domestic manufacturing",
    icon: "⚡",
    category: "Energy",
    baseSummary: "Authorizes federal clean-energy deployment with Buy-American requirements and union prevailing-wage rules.",
    choices: [
      {
        key: "investment",
        label: "Investment scale",
        hint: "How aggressively to fund the transition",
        options: [
          {
            value: "targeted",
            label: "Targeted — $120B over 5 years",
            summaryClause: "Funds solar, storage, and grid upgrades in distressed energy communities only.",
          },
          {
            value: "major",
            label: "Major — $350B grid package",
            summaryClause: "Modernizes interstate transmission, deploys utility-scale renewables, and retools shuttered plants.",
          },
          {
            value: "full",
            label: "Full transition — $800B",
            summaryClause: "Accelerates full-sector decarbonization with direct grants to states and a national green bank.",
          },
        ],
      },
      {
        key: "payfor",
        label: "Pay-for",
        options: [
          {
            value: "subsidies",
            label: "Repeal fossil subsidies",
            summaryClause: "Offsets cost by ending legacy oil & gas tax preferences.",
          },
          {
            value: "carbon",
            label: "Corporate carbon fee",
            summaryClause: "Offsets cost with a phased fee on large industrial emitters.",
          },
          {
            value: "deficit",
            label: "Deficit finance",
            summaryClause: "Financed through Treasury borrowing; scored as emergency competitiveness spending.",
          },
        ],
      },
    ],
  },
  {
    id: "healthcare-affordability",
    title: "Healthcare Affordability Act",
    tagline: "Lower premiums & expand coverage",
    icon: "🏥",
    category: "Health",
    baseSummary: "Reforms the individual market and strengthens federal oversight of insurer rate increases.",
    choices: [
      {
        key: "coverage",
        label: "Coverage model",
        options: [
          {
            value: "aca-subsidies",
            label: "Expand ACA premium subsidies",
            summaryClause: "Caps benchmark premiums at 8.5% of income through 2030 and closes the family glitch.",
          },
          {
            value: "public-option",
            label: "Public option pilot",
            summaryClause: "Creates a Medicare-administered public plan in ten competitive markets with provider rate benchmarks.",
          },
          {
            value: "buy-in-60",
            label: "Medicare buy-in at 60",
            summaryClause: "Allows Americans aged 60–64 to purchase Medicare coverage on the ACA exchanges.",
          },
        ],
      },
      {
        key: "drugs",
        label: "Drug pricing",
        options: [
          {
            value: "negotiate-top50",
            label: "Negotiate top 50 drugs",
            summaryClause: "Authorizes HHS to negotiate prices for the fifty highest-spend Part D medications.",
          },
          {
            value: "cap-oop",
            label: "Cap out-of-pocket at $2K",
            summaryClause: "Sets a $2,000 annual out-of-pocket cap for all ACA marketplace plans.",
          },
          {
            value: "both",
            label: "Negotiate + cap",
            summaryClause: "Combines Medicare negotiation authority with a marketplace out-of-pocket cap.",
          },
        ],
      },
    ],
  },
  {
    id: "build-america",
    title: "Build America Infrastructure Act",
    tagline: "Roads, broadband, water systems",
    icon: "🛤",
    category: "Infrastructure",
    baseSummary: "Establishes a federal infrastructure accelerator with streamlined permitting and Davis-Bacon wages.",
    choices: [
      {
        key: "priority",
        label: "Build priority",
        options: [
          {
            value: "transport",
            label: "Roads & bridges",
            summaryClause: "Prioritizes structurally deficient bridges and interstate freight corridors.",
          },
          {
            value: "broadband",
            label: "Rural broadband",
            summaryClause: "Mandates fiber-to-the-premises in census tracts below 25/3 Mbps service.",
          },
          {
            value: "water",
            label: "Water & lead pipes",
            summaryClause: "Funds lead service-line replacement and PFAS remediation in public systems.",
          },
        ],
      },
      {
        key: "scale",
        label: "Package size",
        options: [
          {
            value: "slim",
            label: "Slim — $180B",
            summaryClause: "Narrow, pay-as-you-go package focused on the highest-need projects.",
          },
          {
            value: "standard",
            label: "Standard — $550B",
            summaryClause: "Five-year authorization with formula grants to states and competitive innovation awards.",
          },
          {
            value: "bold",
            label: "Bold — $1.1T",
            summaryClause: "Ten-year capital plan including high-speed rail corridors and port electrification.",
          },
        ],
      },
    ],
  },
  {
    id: "worker-rights",
    title: "Worker Rights & Wages Act",
    tagline: "Wages, organizing, workplace standards",
    icon: "✊",
    category: "Labor",
    baseSummary: "Updates federal labor law enforcement and minimum compensation standards.",
    choices: [
      {
        key: "wage",
        label: "Minimum wage",
        options: [
          {
            value: "12-phased",
            label: "$12/hr phased over 4 years",
            summaryClause: "Raises the federal floor to $12 with regional hardship waivers for small employers.",
          },
          {
            value: "15-national",
            label: "$15/hr national",
            summaryClause: "Sets a $15 federal minimum wage indexed to median wage growth after full phase-in.",
          },
          {
            value: "index-only",
            label: "Index current wage only",
            summaryClause: "Indexes the existing minimum to CPI without a new statutory floor increase.",
          },
        ],
      },
      {
        key: "union",
        label: "Organizing rules",
        options: [
          {
            value: "card-check-lite",
            label: "Streamlined elections",
            summaryClause: "Shortens NLRB election timelines and increases penalties for captive-audience meetings.",
          },
          {
            value: "strike-protect",
            label: "Protect strikers",
            summaryClause: "Bars permanent replacements during lawful strikes and expands secondary-boycott protections.",
          },
          {
            value: "enforce-only",
            label: "Enforcement surge",
            summaryClause: "Doubles DOL Wage-and-Hour investigators without changing organizing procedure.",
          },
        ],
      },
    ],
  },
  {
    id: "tax-fairness",
    title: "Tax Fairness Act",
    tagline: "Middle-class relief & corporate minimums",
    icon: "📊",
    category: "Tax",
    baseSummary: "Restructures individual and corporate tax code provisions scored over ten years.",
    choices: [
      {
        key: "individual",
        label: "Individual relief",
        options: [
          {
            value: "ctc",
            label: "Expand child tax credit",
            summaryClause: "Restores fully refundable $3,600 child tax credit with monthly advance payments.",
          },
          {
            value: "millionaire",
            label: "Millionaire surcharge",
            summaryClause: "Adds a 2% surtax on adjusted gross income above $10 million.",
          },
          {
            value: "salt-cap",
            label: "Raise SALT cap to $40K",
            summaryClause: "Increases the state-and-local tax deduction cap from $10,000 to $40,000 through 2028.",
          },
        ],
      },
      {
        key: "corporate",
        label: "Corporate base",
        options: [
          {
            value: "min-15",
            label: "15% minimum tax",
            summaryClause: "Applies a 15% book-income minimum to corporations reporting over $1B in profits.",
          },
          {
            value: "buyback-tax",
            label: "Stock buyback excise",
            summaryClause: "Imposes a 1% excise tax on net corporate share repurchases.",
          },
          {
            value: "both-corp",
            label: "Minimum + buyback tax",
            summaryClause: "Combines the corporate minimum tax with a buyback excise to fund individual relief.",
          },
        ],
      },
    ],
  },
];

const REPUBLICAN_TEMPLATES: LegislativeBillTemplate[] = [
  {
    id: "border-security",
    title: "Border Security Act",
    tagline: "Enforcement surge & asylum reform",
    icon: "🛡",
    category: "Security",
    baseSummary: "Surges border personnel and technology while tightening asylum processing timelines.",
    choices: [
      {
        key: "enforcement",
        label: "Enforcement posture",
        options: [
          {
            value: "surge",
            label: "Personnel surge",
            summaryClause: "Deploys 10,000 additional agents and expands detention capacity.",
          },
          {
            value: "wall-tech",
            label: "Barrier + sensors",
            summaryClause: "Funds physical barriers in high-traffic sectors plus autonomous surveillance towers.",
          },
        ],
      },
    ],
  },
  {
    id: "energy-independence",
    title: "Energy Independence Act",
    tagline: "Domestic production & permitting",
    icon: "🛢",
    category: "Energy",
    baseSummary: "Accelerates domestic energy permitting and restricts foreign supply-chain dependence.",
    choices: [
      {
        key: "permitting",
        label: "Permitting reform",
        options: [
          {
            value: "fast-track",
            label: "Fast-track fossil leases",
            summaryClause: "Sets 90-day deadlines for federal drilling and mining permits.",
          },
          {
            value: "all-source",
            label: "All-of-the-above",
            summaryClause: "Streamlines permits for oil, gas, nuclear, and critical-mineral projects equally.",
          },
        ],
      },
    ],
  },
  {
    id: "tax-relief",
    title: "Tax Relief Act",
    tagline: "Middle-class brackets & small business",
    icon: "💵",
    category: "Tax",
    baseSummary: "Adjusts individual brackets and small-business expensing without changing corporate rates.",
    choices: [
      {
        key: "relief",
        label: "Relief target",
        options: [
          {
            value: "brackets",
            label: "Bracket adjustment",
            summaryClause: "Lowers marginal rates for filers earning under $400,000.",
          },
          {
            value: "small-biz",
            label: "Small-business expensing",
            summaryClause: "Permanently raises Section 179 expensing limits for pass-through employers.",
          },
        ],
      },
    ],
  },
];

export function getLegislativeBillTemplates(party: string): LegislativeBillTemplate[] {
  return party === "republican" ? REPUBLICAN_TEMPLATES : DEMOCRAT_TEMPLATES;
}

export function defaultChoicesForTemplate(template: LegislativeBillTemplate): Record<string, string> {
  return Object.fromEntries(template.choices.map((c) => [c.key, c.options[0]?.value ?? ""]));
}

export function composeBillFromTemplate(
  template: LegislativeBillTemplate,
  choices: Record<string, string>,
): { title: string; summary: string } {
  const clauses = [template.baseSummary];
  for (const choice of template.choices) {
    const picked =
      choice.options.find((o) => o.value === choices[choice.key]) ??
      choice.options[0];
    if (picked?.summaryClause) clauses.push(picked.summaryClause);
  }
  return { title: template.title, summary: clauses.join(" ") };
}

export function findTemplateByTitle(party: string, title: string): LegislativeBillTemplate | undefined {
  return getLegislativeBillTemplates(party).find((t) => t.title === title.trim());
}

/** Human-readable policy labels for a filed bill title (best-effort match). */
export function describePolicyChoices(
  party: string,
  title: string,
  summary: string,
): { choiceLabels: string[] } | null {
  const template = findTemplateByTitle(party, title);
  if (!template) return null;
  const labels: string[] = [];
  for (const choice of template.choices) {
    const match = choice.options.find((o) => summary.includes(o.summaryClause));
    if (match) labels.push(`${choice.label}: ${match.label}`);
  }
  return labels.length ? { choiceLabels: labels } : null;
}
