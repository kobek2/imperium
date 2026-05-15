import { DefenseProcurementLaneRow } from "@/components/defense-procurement-lane-row";
import type { DefenseProcurementOverview } from "@/lib/defense-procurement-budget";
import {
  DEFENSE_PROCUREMENT_CATEGORIES,
  DEFENSE_PROCUREMENT_CATEGORY_LABELS,
  isDefenseProcurementCategory,
  modernizationKeyForCategory,
} from "@/lib/defense-procurement-budget";

const fmtUsd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Math.max(0, n),
  );

export function DefenseProcurementPanel({
  overview,
  procurementLedgerReady,
  canAct,
  defenseBody,
}: {
  overview: DefenseProcurementOverview | null;
  procurementLedgerReady: boolean;
  canAct: boolean;
  defenseBody: Record<string, unknown>;
}) {
  if (!procurementLedgerReady) {
    return (
      <section className="rounded-2xl border border-amber-600 bg-amber-50 p-5 text-sm text-amber-950 shadow-sm">
        <p className="font-semibold">War chest not wired up yet</p>
        <p className="mt-2">
          Run{" "}
          <code className="rounded bg-white/80 px-1 font-mono text-xs">20260527100000_defense_procurement_obligations.sql</code>{" "}
          so spending can hit the defense budget line.
        </p>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="rounded-2xl border border-[var(--psc-border)] bg-white/40 p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">War chest</h2>
        <p className="mt-2 text-sm text-[var(--psc-muted)]">No active fiscal year — nothing to spend yet.</p>
      </section>
    );
  }

  const { fiscalYearLabel, defenseCap, obligatedTotal, budgetSubmitted, recent } = overview;
  const remaining = Math.max(0, defenseCap - obligatedTotal);
  const canObligate = canAct && budgetSubmitted && defenseCap > 0;

  return (
    <section className="rounded-2xl border border-[var(--psc-border)] bg-white/35 p-5 shadow-sm backdrop-blur-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">War chest</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--psc-muted)]">
            Top row: package only. Amber row: same package plus <span className="font-mono">$100M</span> modernize
            (doubles military power from that buy and ticks the lane bar). Caps: {fiscalYearLabel} defense line. RP
            ledger only — not the federal treasury wallet.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-800/20 bg-emerald-50/80 px-3 py-2 text-right text-xs text-emerald-950">
          <p>
            <span className="text-[var(--psc-muted)]">Left to obligate</span>{" "}
            <span className="font-mono text-base font-bold">{fmtUsd(remaining)}</span>
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-emerald-900/80">
            of {fmtUsd(defenseCap)} · used {fmtUsd(obligatedTotal)}
          </p>
        </div>
      </div>

      {!budgetSubmitted ? (
        <p className="mt-4 rounded-lg border border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          The President still needs to <span className="font-semibold">submit</span> the federal budget — store stays
          locked until then.
        </p>
      ) : defenseCap <= 0 ? (
        <p className="mt-4 text-sm text-[var(--psc-muted)]">Defense line is set to zero in the budget workbook.</p>
      ) : null}

      <div className="mt-4 divide-y divide-[var(--psc-border)] rounded-xl border border-[var(--psc-border)] bg-white/50 px-3">
        {DEFENSE_PROCUREMENT_CATEGORIES.map((c) => {
          const modKey = modernizationKeyForCategory(c);
          const modScore = Number(defenseBody[modKey] ?? 0);
          return (
            <DefenseProcurementLaneRow
              key={c}
              category={c}
              disabled={!canObligate}
              modScore={Number.isFinite(modScore) ? modScore : 0}
            />
          );
        })}
      </div>

      {recent.length > 0 ? (
        <div className="mt-6 border-t border-[var(--psc-border)] pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Recent receipts</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {recent.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap justify-between gap-2 rounded-lg border border-[var(--psc-border)] bg-white/50 px-3 py-2"
              >
                <span className="text-[var(--psc-ink)]">
                  {isDefenseProcurementCategory(r.category)
                    ? DEFENSE_PROCUREMENT_CATEGORY_LABELS[r.category]
                    : r.category}
                  {r.memo ? <span className="text-[var(--psc-muted)]"> — {r.memo}</span> : null}
                </span>
                <span className="font-mono text-xs text-[var(--psc-muted)]">
                  {fmtUsd(r.amount_obligated)} · {new Date(r.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
