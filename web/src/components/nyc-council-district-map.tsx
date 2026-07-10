"use client";

import { geoMercator, geoPath } from "d3-geo";
import { useCallback, useMemo, useState } from "react";
import { ProfileImageWithFallback } from "@/components/profile-image-with-fallback";
import type { WardDistrictRow } from "@/lib/city-office-data";
import { NYC_BOROUGH_GEOJSON } from "@/lib/nyc-borough-geojson";
import { NYC_COUNCIL_DISTRICT_GEOJSON } from "@/lib/nyc-council-district-geojson";
import type { Feature, MultiPolygon, Polygon } from "geojson";

export type NycDistrictMapRow = Pick<
  WardDistrictRow,
  | "code"
  | "name"
  | "borough"
  | "pvi"
  | "pviLabel"
  | "incumbentName"
  | "incumbentParty"
  | "faceClaimUrl"
>;

type Props = {
  districts: NycDistrictMapRow[];
  selectedCode?: string | null;
  onSelect?: (code: string) => void;
  showPortraits?: boolean;
  compact?: boolean;
};

type DistrictFeature = Feature<MultiPolygon | Polygon, { code: string; borough: string }>;

const MAP_WIDTH = 520;
const MAP_HEIGHT = 640;

const WATER_FILL = "#7eb8d8";
const COAST_STROKE = "#475569";
const DISTRICT_STROKE = "#334155";

/** One label per borough — shown on the largest district in that borough. */
const BOROUGH_LABEL_DISTRICT: Record<string, string> = {
  Bronx: "W06",
  Manhattan: "W02",
  Brooklyn: "W04",
  Queens: "W05",
  "Staten Island": "W07",
};

const COORD_DECIMALS = 2;

/** Normalize projected SVG coordinates so SSR and client hydration match. */
function roundCoord(n: number): number {
  const factor = 10 ** COORD_DECIMALS;
  return Math.round(n * factor) / factor;
}

/** Round numeric tokens in an SVG path `d` string for SSR/client parity. */
function roundPathD(d: string): string {
  return d.replace(/[-+]?(?:\d+\.\d+|\.\d+|\d+)(?:[eE][-+]?\d+)?/g, (match) => {
    const n = Number(match);
    return Number.isFinite(n) ? String(roundCoord(n)) : match;
  });
}

function partyFill(party: string | null | undefined, pvi: number): { fill: string; stroke: string; text: string } {
  const strength = Math.min(Math.abs(pvi) / 32, 1);
  if (party === "republican") {
    const fill = strength > 0.5 ? "#ef4444" : "#f87171";
    return { fill, stroke: "#b91c1c", text: "#7f1d1d" };
  }
  if (party === "democrat") {
    const fill = strength > 0.5 ? "#3b82f6" : "#60a5fa";
    return { fill, stroke: "#1d4ed8", text: "#1e3a8a" };
  }
  return { fill: "#e5e7eb", stroke: "#6b7280", text: "#374151" };
}

function partyShort(party: string | null | undefined) {
  if (party === "democrat") return "D";
  if (party === "republican") return "R";
  return "—";
}

function DistrictDetail({
  district,
  showPortraits,
  selected,
}: {
  district: NycDistrictMapRow;
  showPortraits?: boolean;
  selected?: boolean;
}) {
  const tone = partyFill(district.incumbentParty, district.pvi);
  return (
    <div
      className={`rounded border px-3 py-2.5 text-xs ${
        selected ? "ring-2 ring-[var(--psc-accent)]" : "border-[var(--psc-border)]"
      }`}
      style={{ backgroundColor: `${tone.fill}55`, borderColor: tone.stroke }}
    >
      <div className="flex items-start gap-2">
        {showPortraits && district.incumbentName ? (
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-[var(--psc-canvas)]">
            <ProfileImageWithFallback
              src={district.faceClaimUrl}
              name={district.incumbentName}
              variant="portrait"
              initialClassName="flex h-full w-full items-center justify-center text-[10px] font-semibold text-[var(--psc-muted)]"
            />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="font-mono text-sm font-bold text-[var(--psc-ink)]">{district.code}</span>
            <span className="font-semibold" style={{ color: tone.text }}>
              {district.pviLabel}
            </span>
            {district.incumbentParty ? (
              <span
                className="rounded border bg-white/80 px-1 py-0.5 font-mono text-[10px]"
                style={{ borderColor: tone.stroke, color: tone.text }}
              >
                {partyShort(district.incumbentParty)}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 font-medium leading-snug text-[var(--psc-ink)]">{district.name}</p>
          <p className="mt-0.5 text-[var(--psc-muted)]">{district.borough}</p>
          {district.incumbentName ? (
            <p className="mt-1 text-[var(--psc-muted)]">
              Incumbent:{" "}
              <span className="font-semibold text-[var(--psc-ink)]">{district.incumbentName}</span>
            </p>
          ) : (
            <p className="mt-1 italic text-[var(--psc-muted)]">Incumbent TBD</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function NycCouncilDistrictMap({
  districts,
  selectedCode,
  onSelect,
  showPortraits = false,
  compact = false,
}: Props) {
  const districtByCode = useMemo(() => {
    const map = new Map<string, NycDistrictMapRow>();
    for (const d of districts) map.set(d.code.toUpperCase(), d);
    return map;
  }, [districts]);

  const [hoveredCode, setHoveredCode] = useState<string | null>(null);

  const activeCode = (hoveredCode ?? selectedCode)?.toUpperCase() ?? null;
  const activeDistrict = activeCode ? districtByCode.get(activeCode) : null;

  const handleSelect = useCallback(
    (code: string) => {
      onSelect?.(code);
    },
    [onSelect],
  );

  const clickable = Boolean(onSelect);

  const { districtPaths, coastPaths } = useMemo(() => {
    const projection = geoMercator().fitSize([MAP_WIDTH, MAP_HEIGHT], NYC_BOROUGH_GEOJSON);
    const pathGen = geoPath(projection);
    const districtFeatures = NYC_COUNCIL_DISTRICT_GEOJSON.features as DistrictFeature[];

    const districtPaths = districtFeatures.map((feature) => {
      const [labelX, labelY] = pathGen.centroid(feature);
      return {
        feature,
        d: roundPathD(pathGen(feature) ?? ""),
        labelX: roundCoord(labelX),
        labelY: roundCoord(labelY),
      };
    });

    const coastPaths = (NYC_BOROUGH_GEOJSON.features as DistrictFeature[]).map((feature) => ({
      borough: feature.properties.borough,
      d: roundPathD(pathGen(feature) ?? ""),
    }));

    return { districtPaths, coastPaths };
  }, []);

  return (
    <div className={`grid gap-4 ${compact ? "" : "lg:grid-cols-[minmax(0,1fr)_14rem]"}`}>
      <div className="overflow-hidden rounded border border-[var(--psc-border)] bg-sky-50/40 p-2">
        <svg
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          role="img"
          aria-label="New York City council district map"
          className="mx-auto h-auto w-full max-w-lg"
        >
          <rect x={0} y={0} width={MAP_WIDTH} height={MAP_HEIGHT} fill={WATER_FILL} />

          {districtPaths.map(({ feature, d, labelX, labelY }) => {
            const code = feature.properties.code.toUpperCase();
            const district = districtByCode.get(code);
            if (!district) return null;

            const tone = partyFill(district.incumbentParty, district.pvi);
            const isSelected = selectedCode?.toUpperCase() === code;
            const isHovered = hoveredCode === code;
            const showBoroughLabel =
              !compact && BOROUGH_LABEL_DISTRICT[feature.properties.borough] === code;

            return (
              <g key={code}>
                <path
                  d={d}
                  fill={tone.fill}
                  stroke={isSelected || isHovered ? "#0f172a" : DISTRICT_STROKE}
                  strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1.25}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  className={clickable ? "cursor-pointer transition-[stroke-width,opacity] duration-150" : ""}
                  opacity={hoveredCode && !isHovered && !isSelected ? 0.72 : 1}
                  onMouseEnter={() => setHoveredCode(code)}
                  onMouseLeave={() => setHoveredCode(null)}
                  onClick={() => handleSelect(code)}
                  aria-label={`${code} ${district.name}`}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSelect(code);
                          }
                        }
                      : undefined
                  }
                />
                {Number.isFinite(labelX) && Number.isFinite(labelY) ? (
                  <>
                    <text
                      x={labelX}
                      y={labelY - 6}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight="700"
                      fill={tone.text}
                      pointerEvents="none"
                      fontFamily="ui-monospace, monospace"
                    >
                      {code}
                    </text>
                    {district.incumbentParty ? (
                      <text
                        x={labelX}
                        y={labelY + 9}
                        textAnchor="middle"
                        fontSize={10}
                        fontWeight="600"
                        fill={tone.stroke}
                        pointerEvents="none"
                      >
                        {partyShort(district.incumbentParty)}
                      </text>
                    ) : null}
                    {showBoroughLabel ? (
                      <text
                        x={labelX}
                        y={labelY + (district.incumbentParty ? 22 : 12)}
                        textAnchor="middle"
                        fontSize={9}
                        fontWeight="600"
                        fill="#475569"
                        pointerEvents="none"
                        style={{ fontVariant: "small-caps" }}
                        letterSpacing="0.06em"
                      >
                        {feature.properties.borough}
                      </text>
                    ) : null}
                  </>
                ) : null}
              </g>
            );
          })}

          {/* Borough coastlines for crisp shoreline detail */}
          {coastPaths.map(({ borough, d }) => (
            <path
              key={`coast-${borough}`}
              d={d}
              fill="none"
              stroke={COAST_STROKE}
              strokeWidth={1.5}
              strokeLinejoin="round"
              pointerEvents="none"
            />
          ))}

          <g transform="translate(12, 12)">
            <rect x="0" y="0" width="108" height="44" rx="4" fill="white" fillOpacity="0.92" stroke="#cbd5e1" />
            <rect x="8" y="10" width="12" height="12" rx="2" fill="#3b82f6" stroke="#1d4ed8" strokeWidth="0.75" />
            <text x="26" y="19" fontSize="9" fill="#334155">
              Democratic
            </text>
            <rect x="8" y="26" width="12" height="12" rx="2" fill="#ef4444" stroke="#b91c1c" strokeWidth="0.75" />
            <text x="26" y="35" fontSize="9" fill="#334155">
              Republican
            </text>
          </g>
        </svg>
      </div>

      <div className="space-y-2">
        {activeDistrict ? (
          <DistrictDetail
            district={activeDistrict}
            showPortraits={showPortraits}
            selected={selectedCode?.toUpperCase() === activeDistrict.code}
          />
        ) : (
          <p className="rounded border border-dashed border-[var(--psc-border)] bg-white/60 px-3 py-2 text-xs text-[var(--psc-muted)]">
            {clickable ? "Click a district to select your home seat, or hover for details." : "Hover a district for details."}
          </p>
        )}

        {!compact ? (
          <ul className="space-y-1.5 text-xs">
            {districts.map((d) => {
              const tone = partyFill(d.incumbentParty, d.pvi);
              const selected = selectedCode?.toUpperCase() === d.code;
              return (
                <li key={d.code}>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => handleSelect(d.code)}
                    className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left transition ${
                      clickable ? "cursor-pointer hover:bg-white/80" : "cursor-default"
                    } ${selected ? "ring-2 ring-[var(--psc-accent)]" : ""}`}
                    style={{ borderColor: tone.stroke, backgroundColor: `${tone.fill}44` }}
                  >
                    <span className="font-mono font-bold text-[var(--psc-ink)]">{d.code}</span>
                    <span className="min-w-0 flex-1 truncate text-[var(--psc-muted)]">
                      {d.incumbentName ?? "TBD"} · {d.pviLabel}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
