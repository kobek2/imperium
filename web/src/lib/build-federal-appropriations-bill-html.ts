import type { FiscalLineItemRow, FiscalTaxBracketRow } from "@/lib/fiscal-budget-types";
import { lineItemDefaultLabel } from "@/lib/line-item-budget-effects";
import { escapeHtmlPlain } from "@/lib/sanitize-bill-html";

function money(n: number): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `$${x.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function pctDecimal(r: number): string {
  const x = Number(r);
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(2)}%`;
}

/**
 * Rich HTML for an appropriations-style bill (sanitized before persist via `sanitizeBillHtml`).
 */
export function buildFederalAppropriationsBillHtml(input: {
  yearLabel: string;
  taxBrackets: FiscalTaxBracketRow[];
  lineItems: FiscalLineItemRow[];
}): string {
  const y = escapeHtmlPlain(input.yearLabel.trim() || "Active fiscal year");

  const bracketRows = input.taxBrackets
    .map((b, i) => {
      const ceil =
        b.ceiling == null || !Number.isFinite(Number(b.ceiling))
          ? "and above (top bracket)"
          : `up to ${money(Number(b.ceiling))}`;
      return `<tr><td>${i + 1}</td><td>${escapeHtmlPlain(ceil)}</td><td>${pctDecimal(b.rate)}</td></tr>`;
    })
    .join("");

  const lineRows = input.lineItems
    .map((row) => {
      const title = escapeHtmlPlain(lineItemDefaultLabel(row.key));
      const k = escapeHtmlPlain(row.key);
      return `<tr><td>${k}</td><td>${title}</td><td>${money(row.minimum)}</td><td>${money(row.allocated)}</td></tr>`;
    })
    .join("");

  const totalMin = input.lineItems.reduce((s, r) => s + (Number(r.minimum) || 0), 0);
  const totalAlloc = input.lineItems.reduce((s, r) => s + (Number(r.allocated) || 0), 0);

  return `
<h2>Federal appropriations and revenue schedule — ${y}</h2>
<p>This bill sets forth the President&apos;s proposed marginal income tax brackets for the fiscal year identified above, and authorizes aggregate appropriations by program line as enumerated. Amounts are expressed in United States dollars.</p>
<h3>Section 1. Marginal income tax brackets</h3>
<p>Rates are applied marginally to each band of annual <strong>employment-related income</strong> (scheduled role salary and PAC hourly collects posted as <code>hourly_income</code> in the federal ledger), consistent with the active fiscal year window.</p>
<table>
<thead><tr><th>Band</th><th>Annual taxable income in band</th><th>Rate</th></tr></thead>
<tbody>${bracketRows}</tbody>
</table>
<h3>Section 2. Aggregate appropriations by line</h3>
<table>
<thead><tr><th>Line key</th><th>Program</th><th>Minimum</th><th>Allocated</th></tr></thead>
<tbody>${lineRows}</tbody>
</table>
<p><strong>Total minimum:</strong> ${money(totalMin)}. <strong>Total allocated:</strong> ${money(totalAlloc)}.</p>
<h3>Section 3. Enactment</h3>
<p>Upon passage, the Clerk shall transmit a certified copy to the Executive for implementation consistent with existing treasury and fiscal procedures.</p>
`.trim();
}
