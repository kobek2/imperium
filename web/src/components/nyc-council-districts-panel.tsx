"use client";

import Link from "next/link";
import { NycCouncilDistrictMap } from "@/components/nyc-council-district-map";
import { profilePath } from "@/components/profile-card";
import {
  formatDistrictPvi,
  NYC_CITY_NAME,
  NYC_COUNCIL_DISTRICTS,
} from "@/lib/city";
import type { WardDistrictRow } from "@/lib/city-office-data";

type Props = {
  title?: string;
  compact?: boolean;
  selectedCode?: string | null;
  onSelect?: (code: string) => void;
  districts?: WardDistrictRow[];
  showPortraits?: boolean;
};

export function NycCouncilDistrictsPanel({
  title = "New York City council districts",
  compact = false,
  selectedCode,
  onSelect,
  districts,
  showPortraits = false,
}: Props) {
  const rows: WardDistrictRow[] =
    districts ??
    NYC_COUNCIL_DISTRICTS.map((d) => ({
      code: d.code,
      name: d.name,
      borough: d.borough,
      pvi: d.pvi,
      pviLabel: formatDistrictPvi(d.pvi),
      incumbentName: d.incumbentName ?? null,
      incumbentParty: d.incumbentParty ?? null,
      faceClaimUrl: null as string | null,
    }));

  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <h3 className="text-sm font-semibold text-[var(--psc-ink)]">{title}</h3>
      <p className="mt-1 text-xs text-[var(--psc-muted)]">
        {NYC_CITY_NAME} — seven council districts (W01–W07). Positive PVI = Democratic lean; negative = Republican
        lean.
      </p>

      <div className="mt-3">
        <NycCouncilDistrictMap
          districts={rows}
          selectedCode={selectedCode}
          onSelect={onSelect}
          showPortraits={showPortraits}
          compact={compact}
        />
      </div>
    </section>
  );
}

export function NycCouncilDistrictLink({ holderId, name }: { holderId: string | null; name: string }) {
  const href = holderId ? profilePath(holderId) : null;
  if (!href) return <span className="font-semibold">{name}</span>;
  return (
    <Link href={href} className="font-semibold text-[var(--psc-accent)] hover:underline">
      {name}
    </Link>
  );
}
