import { defenseObligateProcurement } from "@/app/actions/cabinet-portfolios";
import { SubmitButton } from "@/components/submit-button";
import type { DefenseProcurementCategory } from "@/lib/defense-procurement-budget";
import { DEFENSE_PROCUREMENT_CATEGORY_LABELS, DEFENSE_PROCUREMENT_PACKAGES } from "@/lib/defense-procurement-budget";
import { DEFENSE_MODERNIZE_SURCHARGE_USD } from "@/lib/military-power";

const fmtUsd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Math.max(0, n),
  );

export function DefenseProcurementLaneRow({
  category,
  disabled,
  modScore,
}: {
  category: DefenseProcurementCategory;
  disabled: boolean;
  modScore: number;
}) {
  const title = DEFENSE_PROCUREMENT_CATEGORY_LABELS[category];

  return (
    <div className="flex flex-col gap-2 border-b border-[var(--psc-border)] py-3 last:border-b-0 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-3">
      <div className="min-w-0 flex-1 sm:max-w-[14rem]">
        <p className="font-semibold leading-tight text-[var(--psc-ink)]">{title}</p>
        <p className="font-mono text-[10px] text-[var(--psc-muted)]">Lane mod {Math.round(modScore)}/100</p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:items-end">
        <div className="flex flex-wrap gap-1.5 sm:justify-end">
          {DEFENSE_PROCUREMENT_PACKAGES.map((pkg) => (
            <form key={pkg.id} action={defenseObligateProcurement} className="inline">
              <input type="hidden" name="category" value={category} />
              <input type="hidden" name="package_id" value={pkg.id} />
              <SubmitButton
                disabled={disabled}
                className="whitespace-nowrap rounded-md border border-emerald-800/35 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-emerald-950 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                title={pkg.tagline}
              >
                {pkg.label} · {fmtUsd(pkg.amount)}
              </SubmitButton>
            </form>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 sm:justify-end">
          {DEFENSE_PROCUREMENT_PACKAGES.map((pkg) => {
            const total = pkg.amount + DEFENSE_MODERNIZE_SURCHARGE_USD;
            return (
              <form key={`${pkg.id}-mod`} action={defenseObligateProcurement} className="inline">
                <input type="hidden" name="category" value={category} />
                <input type="hidden" name="package_id" value={pkg.id} />
                <input type="hidden" name="modernize" value="on" />
                <SubmitButton
                  disabled={disabled}
                  className="whitespace-nowrap rounded-md border border-amber-800/40 bg-amber-50/90 px-2.5 py-1.5 text-[11px] font-semibold text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  title={`${pkg.tagline} Adds $100M modernization surcharge, doubles military power from this package, and advances the lane mod bar.`}
                >
                  +Mod · {pkg.label} · {fmtUsd(total)}
                </SubmitButton>
              </form>
            );
          })}
        </div>
      </div>
    </div>
  );
}
