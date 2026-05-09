import type { PartyCounts } from "@/lib/congress-composition";

type SeatParty = "democrat" | "republican" | "independent";

const PARTY_FILL: Record<SeatParty, string> = {
  democrat: "var(--ch-hemi-dem, #1d4ed8)",
  republican: "var(--ch-hemi-gop, #b91c1c)",
  independent: "var(--ch-hemi-ind, #a16207)",
};

const PARTY_LABEL: Record<SeatParty, string> = {
  democrat: "Democrats",
  republican: "Republicans",
  independent: "Independents",
};

function distributeAcrossRows(total: number, rowCount: number): number[] {
  if (total <= 0 || rowCount <= 0) return [];
  const base = Math.floor(total / rowCount);
  const rem = total % rowCount;
  return Array.from({ length: rowCount }, (_, i) => base + (i < rem ? 1 : 0));
}

/** Left-to-right block order along the arc (Democrats, Independents, Republicans). Unset party counts as independent. */
function buildSeatParties(counts: PartyCounts): SeatParty[] {
  const out: SeatParty[] = [];
  for (let j = 0; j < counts.democrat; j++) out.push("democrat");
  for (let j = 0; j < counts.independent + counts.other; j++) out.push("independent");
  for (let j = 0; j < counts.republican; j++) out.push("republican");
  return out;
}

type SeatPoint = { x: number; y: number; angle: number };

function seatGeometry(total: number, rows: number): SeatPoint[] {
  if (total <= 0) return [];
  const rowCount = Math.min(rows, Math.max(1, Math.ceil(total / 8)));
  const perRow = distributeAcrossRows(total, rowCount);
  const cx = 100;
  const cy = 102;
  const innerR = 22;
  const outerR = 78;
  const pts: SeatPoint[] = [];
  for (let r = 0; r < rowCount; r++) {
    const count = perRow[r] ?? 0;
    if (count <= 0) continue;
    const t = rowCount <= 1 ? 0 : r / (rowCount - 1);
    const radius = innerR + t * (outerR - innerR);
    for (let s = 0; s < count; s++) {
      const angle = Math.PI - (count > 1 ? s / (count - 1) : 0.5) * Math.PI;
      pts.push({
        x: cx + radius * Math.cos(angle),
        y: cy - radius * Math.sin(angle),
        angle,
      });
    }
  }
  pts.sort((a, b) => b.angle - a.angle || a.y - b.y);
  return pts;
}

export function ChamberHemicycle({
  title,
  counts,
}: {
  title: string;
  counts: PartyCounts;
}) {
  const total =
    counts.democrat + counts.republican + counts.independent + counts.other;
  const seats = buildSeatParties(counts);
  const geom = seatGeometry(total, 5);
  const dotR = total <= 0 ? 2 : Math.max(1.35, Math.min(2.8, 3.1 - total / 140));

  return (
    <div className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm">
      <h3 className="text-center text-sm font-semibold tracking-tight text-[var(--psc-ink)]">{title}</h3>
      {total === 0 ? (
        <p className="mt-6 text-center text-sm text-[var(--psc-muted)]">No members seated yet.</p>
      ) : (
        <svg
          viewBox="0 0 200 118"
          className="mt-4 h-auto w-full max-w-md mx-auto"
          role="img"
          aria-label={`${title}: party balance visualization`}
        >
          <line
            x1="100"
            y1="8"
            x2="100"
            y2="22"
            stroke="var(--psc-border)"
            strokeWidth="1"
          />
          {geom.map((pt, idx) => {
            const party = seats[idx] ?? "independent";
            return (
              <circle
                key={`${idx}-${pt.x.toFixed(2)}`}
                cx={pt.x}
                cy={pt.y}
                r={dotR}
                fill={PARTY_FILL[party]}
                stroke="var(--psc-canvas)"
                strokeWidth="0.35"
              />
            );
          })}
        </svg>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {(["democrat", "republican", "independent"] as const).map((k) => (
          <div key={k} className="flex items-center justify-between gap-2 sm:flex-col sm:items-start">
            <dt className="flex items-center gap-1.5 font-semibold text-[var(--psc-muted)]">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: PARTY_FILL[k] }}
                aria-hidden
              />
              <span className="truncate">{PARTY_LABEL[k]}</span>
            </dt>
            <dd className="font-mono tabular-nums text-[var(--psc-ink)]">
              {k === "independent" ? counts.independent + counts.other : counts[k]}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
