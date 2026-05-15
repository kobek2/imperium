"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  recomputeNationalMetricsLineFunding,
  treasuryPayBudgetLineGap,
  treasuryPayDownUsDebtWithAllCash,
} from "@/app/actions/fiscal";

export type TreasuryOutlayRow = {
  category: string;
  line_item_key: string | null;
  amount: number;
  note: string | null;
  created_at: string;
};

export type TreasuryLineDeployRow = {
  key: string;
  label: string;
  allocated: number;
  deployed: number;
};

function fmtUsd(n: number): string {
  return `$${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function TreasuryCashDeployment({
  lineRows,
  usDebt,
  treasuryBalance,
  recentOutlays,
  debtSpendTotal,
  canDeploy,
}: {
  lineRows: TreasuryLineDeployRow[];
  usDebt: number | null;
  treasuryBalance: number;
  recentOutlays: TreasuryOutlayRow[];
  debtSpendTotal: number;
  canDeploy: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const lineLabelByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of lineRows) m.set(row.key, row.label);
    return m;
  }, [lineRows]);

  const debt = Number(usDebt ?? 0);
  const debtHint =
    debt > 0
      ? `Positive sim debt: the button pays down up to the lesser of treasury cash and this balance.`
      : debt < 0
        ? `Negative sim debt marks a surplus on the ledger; the button moves the metric toward zero using available cash (capped by the surplus magnitude).`
        : `Debt is exactly zero: paying with available cash records a surplus (sim metric goes negative by the amount deployed).`;

  function payLine(key: string) {
    setMsg(null);
    start(async () => {
      const r = await treasuryPayBudgetLineGap({ lineItemKey: key });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  function payDebt() {
    setMsg(null);
    start(async () => {
      const r = await treasuryPayDownUsDebtWithAllCash();
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  return (
    <section
      className="mt-6 rounded border border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-accent)_6%,transparent)] p-5"
      aria-labelledby="treasury-deploy-heading"
    >
      <h3 id="treasury-deploy-heading" className="text-sm font-semibold text-[var(--psc-ink)]">
        Deploy treasury cash
      </h3>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--psc-muted)]">
        Appropriations set each line&apos;s enacted allocation in the budget JSON; tax receipts add to treasury cash first.
        Deployments are a manual ledger of where cash went (line buckets or U.S. debt / surplus). Underfunded lines (deployed
        vs enacted) proportionally stress linked national metrics against the saved baseline; paying a line moves those
        metrics back toward baseline. Admins refresh the baseline when they edit national metrics.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded border border-[var(--psc-border)]/80 bg-[var(--psc-panel)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">U.S. debt (sim, signed)</p>
          <p className="mt-1 font-mono text-lg text-[var(--psc-ink)]">{fmtUsd(debt)}</p>
          <p className="mt-1 text-[11px] text-[var(--psc-muted)]">Paid down cumulatively: {fmtUsd(debtSpendTotal)}</p>
        </div>
        <div className="rounded border border-[var(--psc-border)]/80 bg-[var(--psc-panel)] p-3 lg:col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Treasury cash</p>
          <p className="mt-1 font-mono text-lg text-[var(--psc-ink)]">{fmtUsd(treasuryBalance)}</p>
          <p className="mt-1 text-[11px] text-[var(--psc-muted)]">Available for deployments below.</p>
        </div>
      </div>

      {lineRows.length ? (
        <div className="mt-5 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Budget line buckets</p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--psc-muted)]">
            Each row deploys up to the remaining gap to the enacted allocation, or all treasury cash if that gap is larger
            than the balance.
          </p>
          <ul className="mt-3 divide-y divide-[var(--psc-border)]/70">
            {lineRows.map((row) => {
              const gap = Math.max(0, row.allocated - row.deployed);
              const canPay = canDeploy && treasuryBalance > 0 && gap > 0;
              return (
                <li key={row.key} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--psc-ink)]">{row.label}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-[var(--psc-muted)]">
                      Enacted {fmtUsd(row.allocated)} · deployed {fmtUsd(row.deployed)} · remaining {fmtUsd(gap)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={pending || !canPay}
                    title={!canDeploy ? "Treasury deploy authority required." : gap <= 0 ? "Already at or above allocation." : undefined}
                    onClick={() => payLine(row.key)}
                    className="shrink-0 rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white disabled:opacity-50"
                  >
                    {pending ? "…" : "Pay for line item"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-xs text-[var(--psc-muted)]">No line items on the active budget row yet.</p>
      )}

      {canDeploy ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setMsg(null);
              start(async () => {
                const r = await recomputeNationalMetricsLineFunding();
                setMsg({ ok: r.ok, text: r.message });
                if (r.ok) router.refresh();
              });
            }}
            className="rounded border border-dashed border-[var(--psc-border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--psc-muted)] hover:border-[var(--psc-ink)] hover:text-[var(--psc-ink)] disabled:opacity-50"
          >
            Recompute national metrics from funding
          </button>
        </div>
      ) : null}

      {canDeploy ? (
        <div className="mt-5 space-y-2 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
          <p className="text-xs font-semibold text-[var(--psc-ink)]">U.S. debt / surplus</p>
          <p className="text-[11px] leading-relaxed text-[var(--psc-muted)]">{debtHint}</p>
          <button
            type="button"
            disabled={pending || treasuryBalance <= 0}
            onClick={payDebt}
            className="mt-2 rounded border border-[var(--psc-border)] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)] hover:bg-[color-mix(in_srgb,var(--psc-accent)_10%,transparent)] disabled:opacity-50"
          >
            {pending ? "Applying…" : "Pay down U.S. debt (use all treasury cash)"}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-xs text-[var(--psc-muted)]">
          Only the President, Secretary of the Treasury, or full staff operators may deploy cash from this station.
        </p>
      )}

      {msg ? (
        <p className={`mt-4 text-xs ${msg.ok ? "text-emerald-800" : "text-rose-800"}`} role="status">
          {msg.text}
        </p>
      ) : null}

      {recentOutlays.length ? (
        <div className="mt-5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Recent deployments</p>
          <ul className="mt-2 space-y-1 text-[11px] text-[var(--psc-muted)]">
            {recentOutlays.map((o) => {
              const lineLbl =
                o.category === "budget_line"
                  ? (lineLabelByKey.get(String(o.line_item_key ?? "")) ?? o.line_item_key ?? "—")
                  : null;
              return (
                <li
                  key={`${o.created_at}-${o.amount}-${o.category}-${o.line_item_key ?? ""}`}
                  className="flex flex-wrap justify-between gap-2"
                >
                  <span>
                    {new Date(o.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })} ·{" "}
                    {o.category === "us_debt" ? "Debt paydown / surplus" : `Line: ${lineLbl}`}
                  </span>
                  <span className="font-mono text-[var(--psc-ink)]">{fmtUsd(o.amount)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
