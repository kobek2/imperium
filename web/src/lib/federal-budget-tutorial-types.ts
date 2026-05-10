/** Prior-year figures for the interactive federal budget walkthrough (server-built). */
export type FederalBudgetPriorYearTutorialContext = {
  yearLabel: string;
  totalAppropriations: number;
  estimatedIncomeTax: number;
  /** Tax minus appropriations for that closed year (positive = surplus). */
  impliedNet: number;
  gdpOpening: number | null;
  gdpClosing: number | null;
  totalTaxableSalaryIncome: number;
  playersWithIncome: number;
  /** Cash income tax collected at year close (close summary). */
  taxCollectedTotal: number;
  /** Players with any positive `paid_amount` on that fiscal year. */
  playersWithTaxPaid: number;
};
