import { BUSINESS_SECTORS } from "@/lib/economy-config";
import { formatSectorEffectPct } from "@/lib/legislation-stock";

type Props = {
  namePrefix?: string;
  defaultSector?: string | null;
  defaultEffect?: number | null;
  showHint?: boolean;
};

export function BillEconomicImpactFields({
  namePrefix = "",
  defaultSector = null,
  defaultEffect = null,
  showHint = true,
}: Props) {
  const sectorName = `${namePrefix}affected_sector`;
  const effectName = `${namePrefix}stock_market_effect`;

  return (
    <fieldset className="grid gap-3 rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-4 md:col-span-2">
      <legend className="px-1 text-sm font-semibold text-[var(--psc-ink)]">Stock market impact (optional)</legend>
      {showHint ? (
        <p className="text-xs text-[var(--psc-muted)]">
          When this bill becomes law, public companies in the selected sector move by the configured percentage. Leave
          blank to skip market effects.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-xs font-semibold text-[var(--psc-muted)]">Affected sector</span>
          <select
            name={sectorName}
            defaultValue={defaultSector ?? ""}
            className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
          >
            <option value="">No sector impact</option>
            {BUSINESS_SECTORS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-xs font-semibold text-[var(--psc-muted)]">Stock effect (%)</span>
          <input
            name={effectName}
            type="number"
            step={1}
            min={-100}
            max={100}
            placeholder="e.g. 20 for +20%"
            defaultValue={defaultEffect ?? ""}
            className="border border-[var(--psc-border)] bg-white px-3 py-2 font-mono font-normal"
          />
          {defaultEffect != null ? (
            <span className="text-[10px] text-[var(--psc-muted)]">Suggested: {formatSectorEffectPct(defaultEffect)}</span>
          ) : null}
        </label>
      </div>
    </fieldset>
  );
}
