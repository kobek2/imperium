"use client";

import { formatEffectDelta, type CitySimEffectDeltas } from "@/lib/city-sim-effects";

function EffectRow({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  if (value === 0) return null;
  const positive = value > 0;
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-[var(--psc-border)]/50 py-1.5 last:border-0">
      <span className="text-[var(--psc-ink)]">{label}</span>
      <span
        className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${
          positive ? "text-green-800" : "text-red-800"
        }`}
      >
        {formatEffectDelta(value, suffix)}
      </span>
    </li>
  );
}

export function EffectPreviewRows({
  deltas,
  compact,
}: {
  deltas: CitySimEffectDeltas;
  compact?: boolean;
}) {
  return (
    <ul className={compact ? "text-xs" : "text-sm"}>
      <EffectRow label="Public safety" value={deltas.publicSafety} />
      <EffectRow label="Education" value={deltas.educationQuality} />
      <EffectRow label="Housing affordability" value={deltas.housingAffordability} />
      <EffectRow label="Business climate" value={deltas.businessClimate} />
      <EffectRow label="Economy index" value={deltas.economyIndex} />
      <EffectRow label="Property tax rate" value={deltas.propertyTaxRatePct} suffix="%" />
    </ul>
  );
}
