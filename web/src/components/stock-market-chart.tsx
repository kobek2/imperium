"use client";

export type PriceHistoryPoint = {
  business_id: string;
  business_name: string;
  price_per_share: number;
  recorded_at: string;
};

const LINE_COLORS = [
  "#1d4ed8",
  "#b45309",
  "#047857",
  "#7c3aed",
  "#be123c",
  "#0e7490",
  "#a16207",
  "#4f46e5",
];

type Series = {
  id: string;
  name: string;
  color: string;
  points: Array<{ t: number; indexed: number }>;
};

function buildSeries(history: PriceHistoryPoint[], businessNames: Map<string, string>): Series[] {
  const byBiz = new Map<string, PriceHistoryPoint[]>();
  for (const row of history) {
    const list = byBiz.get(row.business_id) ?? [];
    list.push(row);
    byBiz.set(row.business_id, list);
  }

  const series: Series[] = [];
  let colorIdx = 0;
  for (const [id, points] of byBiz) {
    points.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    const base = Number(points[0]?.price_per_share ?? 0);
    if (base <= 0) continue;
    series.push({
      id,
      name: businessNames.get(id) ?? points[0]?.business_name ?? "Company",
      color: LINE_COLORS[colorIdx % LINE_COLORS.length],
      points: points.map((p) => ({
        t: new Date(p.recorded_at).getTime(),
        indexed: (Number(p.price_per_share) / base) * 100,
      })),
    });
    colorIdx += 1;
  }
  return series;
}

function polyline(points: Array<{ x: number; y: number }>): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

export function StockMarketChart({
  history,
  businessNames,
}: {
  history: PriceHistoryPoint[];
  businessNames: Record<string, string>;
}) {
  const nameMap = new Map(Object.entries(businessNames));
  const series = buildSeries(history, nameMap);

  if (series.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] text-sm text-[var(--psc-muted)]">
        No price history yet — trades will appear here.
      </div>
    );
  }

  const width = 640;
  const height = 220;
  const pad = { top: 12, right: 12, bottom: 28, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const allT = series.flatMap((s) => s.points.map((p) => p.t));
  const minT = Math.min(...allT);
  const maxT = Math.max(...allT);
  const tSpan = Math.max(maxT - minT, 1);

  const allIndexed = series.flatMap((s) => s.points.map((p) => p.indexed));
  const minY = Math.min(95, ...allIndexed) * 0.98;
  const maxY = Math.max(105, ...allIndexed) * 1.02;
  const ySpan = Math.max(maxY - minY, 1);

  const x = (t: number) => pad.left + ((t - minT) / tSpan) * plotW;
  const y = (v: number) => pad.top + plotH - ((v - minY) / ySpan) * plotH;

  const yTicks = [minY, 100, maxY].filter((v, i, arr) => arr.indexOf(v) === i);

  return (
    <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Share prices</h2>
          <p className="text-xs text-[var(--psc-muted)]">Indexed to 100 at each company&apos;s first quote — compare trajectories.</p>
        </div>
        <ul className="flex flex-wrap gap-3 text-xs">
          {series.map((s) => {
            const last = s.points[s.points.length - 1]?.indexed ?? 100;
            const delta = last - 100;
            return (
              <li key={s.id} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                <span>{s.name}</span>
                <span className={`font-mono ${delta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {delta >= 0 ? "+" : ""}
                  {delta.toFixed(1)}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-3xl" role="img" aria-label="Stock price comparison chart">
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--psc-border)"
              strokeDasharray={tick === 100 ? "0" : "4 4"}
            />
            <text x={pad.left - 6} y={y(tick) + 4} textAnchor="end" className="fill-[var(--psc-muted)] text-[10px]">
              {tick.toFixed(0)}
            </text>
          </g>
        ))}
        {series.map((s) => {
          const pts = s.points.map((p) => ({ x: x(p.t), y: y(p.indexed) }));
          return (
            <path
              key={s.id}
              d={polyline(pts)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
    </div>
  );
}
