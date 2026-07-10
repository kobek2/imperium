export type MayorStatementTemplate = {
  key: string;
  label: string;
  body: string;
};

export const MAYOR_PUBLIC_STATEMENT_TEMPLATES: MayorStatementTemplate[] = [
  {
    key: "custom",
    label: "Write your own",
    body: "",
  },
  {
    key: "public_safety",
    label: "Public safety",
    body:
      "New Yorkers deserve neighborhoods where families feel safe walking home at night. My administration will continue investing in community policing, crisis intervention teams, and transparent accountability — while rejecting fear-driven politics that divide our city.",
  },
  {
    key: "fiscal_stewardship",
    label: "Fiscal stewardship",
    body:
      "City government must live within its means without sacrificing core services. We will protect taxpayers, prioritize essential agencies, and publish clear quarterly updates on revenue and spending so every New Yorker can see where their money goes.",
  },
  {
    key: "infrastructure",
    label: "Infrastructure",
    body:
      "Our bridges, roads, water mains, and transit connections are the backbone of daily life. I am directing agencies to accelerate capital maintenance, cut red tape on critical repairs, and bring contractors to the table with measurable deadlines.",
  },
  {
    key: "housing",
    label: "Housing affordability",
    body:
      "Housing is not a luxury — it is the foundation of a stable city. We will pursue policies that expand affordable supply, protect tenants, and ensure new development includes real set-asides for working families in every borough.",
  },
];
