import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import usAtlas from "us-atlas/states-10m.json";

type Props = {
  title?: string;
  compact?: boolean;
};

const REGION_TONES: Record<string, { fill: string; stroke: string }> = {
  NE: { fill: "#dbeafe", stroke: "#1d4ed8" },
  SO: { fill: "#dcfce7", stroke: "#15803d" },
  WE: { fill: "#fee2e2", stroke: "#b91c1c" },
};

const DISTRICT_CODES = {
  NE: ["NE-01", "NE-02", "NE-03"],
  SO: ["SO-01", "SO-02", "SO-03"],
  WE: ["WE-01", "WE-02", "WE-03", "WE-04"],
} as const;

const REGION_LABELS: Record<"NE" | "SO" | "WE", string> = {
  NE: "Northeast & Midwest",
  SO: "South",
  WE: "West",
};

const FIPS_TO_ABBR: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE",
  "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA",
  "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM",
  "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY",
};

const WEST = new Set(["WA", "OR", "CA", "NV", "ID", "UT", "AZ", "NM", "CO", "MT", "WY", "AK", "HI"]);
const NORTHEAST_MIDWEST = new Set([
  "ND", "SD", "NE", "KS", "MN", "IA", "MO", "WI", "IL", "IN", "MI", "OH",
  "PA", "NY", "NJ", "CT", "RI", "MA", "VT", "NH", "ME", "MD", "DE", "DC",
]);
const SOUTH = new Set(["TX", "OK", "AR", "LA", "MS", "AL", "GA", "FL", "SC", "NC", "TN", "KY", "WV", "VA"]);

function regionForAbbr(abbr: string): "NE" | "SO" | "WE" {
  if (WEST.has(abbr)) return "WE";
  if (SOUTH.has(abbr)) return "SO";
  if (NORTHEAST_MIDWEST.has(abbr)) return "NE";
  return "NE";
}

export function RegionsDistrictsMap({ title = "Regions and congressional districts", compact = false }: Props) {
  const mapWidth = 860;
  const mapHeight = 500;

  const geo = feature(usAtlas as any, (usAtlas as any).objects.states) as unknown as {
    features: Array<{ id: string | number; geometry: unknown }>;
  };

  const projection = geoAlbersUsa().fitSize([mapWidth, mapHeight], geo as never);
  const path = geoPath(projection);

  const labelPoints: Record<"WE" | "NE" | "SO", [number, number]> = {
    WE: projection([-114, 39]) as [number, number],
    NE: projection([-84, 43]) as [number, number],
    SO: projection([-87, 33]) as [number, number],
  };

  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <h3 className="text-sm font-semibold text-[var(--psc-ink)]">{title}</h3>
      <p className="mt-1 text-xs text-[var(--psc-muted)]">
        Imperium uses 3 regions and 10 House districts.
      </p>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="overflow-hidden rounded border border-[var(--psc-border)] bg-white p-2">
          <svg
            viewBox={`0 0 ${mapWidth} ${mapHeight}`}
            role="img"
            aria-label="Imperium region and district map"
            className="h-auto w-full"
          >
            {geo.features.map((state) => {
              const id = String(state.id).padStart(2, "0");
              const abbr = FIPS_TO_ABBR[id];
              if (!abbr) return null;
              const region = regionForAbbr(abbr);
              const tone = REGION_TONES[region];
              const centroid = path.centroid(state as never);
              return (
                <g key={id}>
                  <path d={path(state as never) ?? ""} fill={tone.fill} stroke={tone.stroke} strokeWidth={1.1} />
                  {Number.isFinite(centroid[0]) && Number.isFinite(centroid[1]) ? (
                    <text
                      x={centroid[0]}
                      y={centroid[1]}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={10}
                      fontWeight="600"
                      fill={tone.stroke}
                    >
                      {abbr}
                    </text>
                  ) : null}
                </g>
              );
            })}

            <text
              x={labelPoints.WE[0]}
              y={labelPoints.WE[1]}
              textAnchor="middle"
              fontSize="40"
              fontWeight="800"
              fill={REGION_TONES.WE.stroke}
              opacity={0.92}
            >
              WE
            </text>
            <text
              x={labelPoints.NE[0]}
              y={labelPoints.NE[1]}
              textAnchor="middle"
              fontSize="38"
              fontWeight="800"
              fill={REGION_TONES.NE.stroke}
              opacity={0.92}
            >
              NE
            </text>
            <text
              x={labelPoints.SO[0]}
              y={labelPoints.SO[1]}
              textAnchor="middle"
              fontSize="38"
              fontWeight="800"
              fill={REGION_TONES.SO.stroke}
              opacity={0.92}
            >
              SO
            </text>

          </svg>
        </div>

        {!compact ? (
          <div className="space-y-2 text-xs">
            {(["NE", "SO", "WE"] as const).map((code) => (
              <div key={code} className="rounded border border-[var(--psc-border)] bg-white p-2">
                <p className="font-semibold text-[var(--psc-ink)]">
                  {code} — {REGION_LABELS[code]}
                </p>
                <p className="mt-1 text-[var(--psc-muted)]">{DISTRICT_CODES[code].join(", ")}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
