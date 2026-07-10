export type MayorExecutiveOrderTemplate = {
  key: string;
  label: string;
  title: string;
  body: string;
};

export const MAYOR_EXECUTIVE_ORDER_TEMPLATES: MayorExecutiveOrderTemplate[] = [
  {
    key: "custom",
    label: "Write your own",
    title: "",
    body: "",
  },
  {
    key: "agency_coordination",
    label: "Inter-agency coordination",
    title: "Executive Order — Inter-Agency Coordination Directive",
    body:
      "All city agencies shall designate a senior liaison to the Mayor's Office of Operations within ten (10) business days. Weekly coordination memos are required on shared capital projects, permitting backlogs, and cross-borough service delivery. This order is administrative in nature and does not alter appropriations or council-enacted law.",
  },
  {
    key: "transparency",
    label: "Transparency & reporting",
    title: "Executive Order — Public Reporting Standards",
    body:
      "Department heads shall publish monthly dashboards covering service-level metrics material to their mission. Data releases must be posted in plain language and archived for public review. This directive establishes reporting standards only and carries no independent budget authority.",
  },
  {
    key: "emergency_readiness",
    label: "Emergency readiness drill",
    title: "Executive Order — Citywide Readiness Exercise",
    body:
      "The Office of Emergency Management shall conduct a tabletop readiness exercise with all agency commissioners within thirty (30) days. Findings will be summarized for the Mayor's Office and the City Council. This order is preparatory and does not invoke emergency powers or suspend ordinary agency operations.",
  },
];
