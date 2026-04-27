export type FiscalTaxBracketRow = { ceiling: number | null; rate: number };
export type FiscalLineItemRow = {
  key: string;
  label: string;
  /** Persistent anchor before GDP indexing; used to avoid compounding re-inflation. */
  base_minimum?: number;
  minimum: number;
  allocated: number;
};

/** Closed-year totals for YoY comparison on the federal budget page. */
export type PriorFiscalYearBudgetSummary = {
  yearLabel: string;
  totalAppropriations: number;
  /** Federal income tax actually implied by brackets on that year's employment income (closed year). */
  estimatedIncomeTax: number;
  /** Sum of employment income (`hourly_income`) in that closed fiscal year (actual, not projected). */
  totalTaxableSalaryIncome: number;
  playersWithIncome: number;
};
