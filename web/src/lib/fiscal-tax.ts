/** Marginal income tax (matches Postgres `fiscal_marginal_tax`). Rates are decimal (0.025 = 2.5%). */
export type FiscalTaxBracket = { ceiling: number | null; rate: number };

const DEFAULT_BRACKETS: FiscalTaxBracket[] = [
  { ceiling: 20_000, rate: 0 },
  { ceiling: 50_000, rate: 0.025 },
  { ceiling: 100_000, rate: 0.05 },
  { ceiling: 200_000, rate: 0.15 },
  { ceiling: null, rate: 0.405 },
];

/** Parse `federal_budgets.tax_brackets` JSON from the database. */
export function parseTaxBrackets(raw: unknown): FiscalTaxBracket[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_BRACKETS;
  return raw.map((b) => ({
    ceiling:
      b && typeof b === "object" && "ceiling" in b && (b as { ceiling?: unknown }).ceiling != null
        ? Number((b as { ceiling: unknown }).ceiling)
        : null,
    rate: Number((b as { rate?: unknown }).rate ?? 0),
  }));
}

export function computeMarginalIncomeTax(income: number, brackets: FiscalTaxBracket[]): number {
  if (!Number.isFinite(income) || income <= 0) return 0;
  const bands = Array.isArray(brackets) ? brackets : [];
  let prevTop = 0;
  let total = 0;
  for (const band of bands) {
    const r = Number(band.rate);
    const top = band.ceiling == null ? null : Number(band.ceiling);
    if (top == null || Number.isNaN(top)) {
      const slice = Math.max(0, income - prevTop);
      total += slice * (Number.isFinite(r) ? r : 0);
      break;
    }
    const slice = Math.max(0, Math.min(income, top) - prevTop);
    total += slice * (Number.isFinite(r) ? r : 0);
    prevTop = top;
    if (income <= top) break;
  }
  return Math.round(total * 100) / 100;
}
