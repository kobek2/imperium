export type FiscalTaxBracketRow = { ceiling: number | null; rate: number };
export type FiscalLineItemRow = {
  key: string;
  label: string;
  minimum: number;
  allocated: number;
};

/** Closed-year totals for YoY comparison on the federal budget page. */
export type PriorFiscalYearBudgetSummary = {
  yearLabel: string;
  totalAppropriations: number;
  estimatedIncomeTax: number;
  /** Sum of employment income used in the marginal tax preview for that year. */
  totalTaxableSalaryIncome: number;
  playersWithIncome: number;
};
