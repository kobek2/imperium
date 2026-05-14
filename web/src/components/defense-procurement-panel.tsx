import { defenseObligateProcurement } from "@/app/actions/cabinet-portfolios";
import { SubmitButton } from "@/components/submit-button";
import type { DefenseProcurementOverview } from "@/lib/defense-procurement-budget";
import {
  DEFENSE_PROCUREMENT_CATEGORIES,
  DEFENSE_PROCUREMENT_CATEGORY_LABELS,
  isDefenseProcurementCategory,
} from "@/lib/defense-procurement-budget";

const fmtUsd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Math.max(0, n),
  );

const QUICK_SPENDS = [50_000, 200_000, 1_000_000] as const;

const CARD_BLURB: Record<string, string> = {
  weapon_system_modernization: "Better rifles, drones, and night kit.",
  heavy_armor: "Tank battalions and heavy tracks.",
  cavalry_and_mobility: "Scout units and fast columns.",
  aviation_rotary: "Helos that haul and punch.",
  missiles_and_long_range_strike: "Rockets and long shots.",
  munitions_industrial_base: "Factories, shells, and stockpiles.",
};

function CategorySpendCard({
  category,
  disabled,
}: {
  category: (typeof DEFENSE_PROCUREMENT_CATEGORIES)[number];
  disabled: boolean;
}) {
  const title = DEFENSE_PROCUREMENT_CATEGORY_LABELS[category];
  const blurb = CARD_BLURB[category] ?? "";

  return (
    <article className="flex flex-col rounded-xl border border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-4 shadow-sm">
      <div className="min-h-[3.25rem]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Line item</p>
        <h3 className="mt-1 text-base font-semibold leading-snug text-[var(--psc-ink)]">{title}</h3>
        <p className="mt-1 text-xs text-[var(--psc-muted)]">{blurb}</p>
      </div>
      <form action={defenseObligateProcurement} className="mt-4 flex flex-1 flex-col gap-3">
        <input type="hidden" name="category" value={category} />
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--psc-muted)]">
          Custom amount ($)
          <input
            name="amount_obligated"
            type="number"
            min={1}
            step={1}
            placeholder="250000"
            disabled={disabled}
            className="rounded-lg border border-[var(--psc-border)] bg-white px-2 py-2 font-mono text-sm text-[var(--psc-ink)] disabled:opacity-50"
          />
        </label>
        <SubmitButton
          disabled={disabled}
          className="w-full rounded-lg border border-emerald-800/30 bg-emerald-700/90 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          Authorize spend
        </SubmitButton>
        <div className="flex flex-wrap gap-2">
          {QUICK_SPENDS.map((amt) => (
            <button
              key={amt}
              type="submit"
              name="quick_amount"
              value={String(amt)}
              disabled={disabled}
              className="flex-1 rounded-lg border border-[var(--psc-border)] bg-white px-2 py-1.5 text-center font-mono text-xs font-semibold text-[var(--psc-ink)] hover:bg-emerald-50 disabled:opacity-50"
            >
              {fmtUsd(amt)}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--psc-muted)]">
          Tag (optional)
          <input
            name="memo"
            maxLength={2000}
            disabled={disabled}
            placeholder="e.g. 1st Armored refresh"
            className="rounded-lg border border-[var(--psc-border)] bg-white px-2 py-1.5 text-sm text-[var(--psc-ink)] disabled:opacity-50"
          />
        </label>
      </form>
    </article>
  );
}

export function DefenseProcurementPanel({
  overview,
  procurementLedgerReady,
  canAct,
}: {
  overview: DefenseProcurementOverview | null;
  procurementLedgerReady: boolean;
  canAct: boolean;
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
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">War chest store</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--psc-muted)]">
            Like the PAC storefront: pick a lane, punch an amount (or a quick chip), and hit authorize. Caps come from
            the President&apos;s defense line in {fiscalYearLabel}. This is a fun RP ledger — it does not move the real
            treasury wallet.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-800/20 bg-emerald-50/80 px-3 py-2 text-right text-xs text-emerald-950">
          <p>
            <span className="text-[var(--psc-muted)]">Left to spend</span>{" "}
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

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {DEFENSE_PROCUREMENT_CATEGORIES.map((c) => (
          <CategorySpendCard key={c} category={c} disabled={!canObligate} />
        ))}
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
