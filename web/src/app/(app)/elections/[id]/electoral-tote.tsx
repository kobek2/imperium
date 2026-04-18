/**
 * Big horizontal electoral-vote tote board, shown above the map for presidential races.
 * Left side = Democrats, right side = Republicans, independents get their own center stripe.
 * The 270-line marker is always visible so you can eyeball who's over the top.
 */

type CandidateBrief = {
  id: string;
  user_id: string;
  party: string;
  name: string;
};

type Props = {
  candidates: CandidateBrief[];
  evByCandidate: Record<string, number>;
  totalEV: number;
};

function bgFor(party: string) {
  if (party === "democrat") return "bg-blue-600";
  if (party === "republican") return "bg-red-600";
  if (party === "independent") return "bg-emerald-600";
  return "bg-slate-500";
}

export function ElectoralTote({ candidates, evByCandidate, totalEV }: Props) {
  const MAJORITY = Math.floor(totalEV / 2) + 1;

  const withEV = candidates
    .map((c) => ({ ...c, ev: evByCandidate[c.id] ?? 0 }))
    .filter((c) => c.ev > 0);

  // Group into left (D), center (I), right (R), sorted by EVs within each group. This keeps
  // the bar readable even with multiple candidates per party.
  const dems = withEV.filter((c) => c.party === "democrat").sort((a, b) => b.ev - a.ev);
  const reps = withEV.filter((c) => c.party === "republican").sort((a, b) => b.ev - a.ev);
  const inds = withEV.filter((c) => c.party === "independent" || (c.party !== "democrat" && c.party !== "republican")).sort((a, b) => b.ev - a.ev);

  const demTotal = dems.reduce((s, c) => s + c.ev, 0);
  const repTotal = reps.reduce((s, c) => s + c.ev, 0);
  const indTotal = inds.reduce((s, c) => s + c.ev, 0);
  const uncalled = Math.max(0, totalEV - demTotal - repTotal - indTotal);

  return (
    <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <div className="flex items-baseline justify-between text-xs uppercase tracking-wide text-[var(--psc-muted)]">
        <span>Electoral vote totals</span>
        <span>
          {MAJORITY} to win · {totalEV} total
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-blue-700">Democratic</div>
          <div className="font-mono text-2xl font-bold text-blue-700">{demTotal}</div>
          <CandList list={dems} />
        </div>
        {inds.length > 0 ? (
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wide text-emerald-700">Independent</div>
            <div className="font-mono text-2xl font-bold text-emerald-700">{indTotal}</div>
            <CandList list={inds} />
          </div>
        ) : null}
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-red-700">Republican</div>
          <div className="font-mono text-2xl font-bold text-red-700">{repTotal}</div>
          <CandList list={reps} align="right" />
        </div>
      </div>

      {/* The bar. Sections proportional to EV totals. */}
      <div className="relative mt-3 h-5 w-full overflow-hidden rounded bg-[var(--psc-canvas)]">
        {dems.map((c, i) => (
          <div
            key={c.id}
            className={`absolute top-0 h-full ${bgFor(c.party)}`}
            style={{
              left: `${(dems.slice(0, i).reduce((s, x) => s + x.ev, 0) / totalEV) * 100}%`,
              width: `${(c.ev / totalEV) * 100}%`,
            }}
            title={`${c.name} · ${c.ev} EV`}
          />
        ))}
        {inds.map((c, i) => (
          <div
            key={c.id}
            className={`absolute top-0 h-full ${bgFor(c.party)}`}
            style={{
              left: `${((demTotal + inds.slice(0, i).reduce((s, x) => s + x.ev, 0)) / totalEV) * 100}%`,
              width: `${(c.ev / totalEV) * 100}%`,
            }}
            title={`${c.name} · ${c.ev} EV`}
          />
        ))}
        {reps.map((c, i) => (
          <div
            key={c.id}
            className={`absolute top-0 h-full ${bgFor(c.party)}`}
            style={{
              left: `${((demTotal + indTotal + reps.slice(0, i).reduce((s, x) => s + x.ev, 0)) / totalEV) * 100}%`,
              width: `${(c.ev / totalEV) * 100}%`,
            }}
            title={`${c.name} · ${c.ev} EV`}
          />
        ))}
        {/* 270-line marker */}
        <div
          className="absolute top-0 h-full border-l-2 border-dashed border-[var(--psc-ink)]"
          style={{ left: `${(MAJORITY / totalEV) * 100}%` }}
          title={`${MAJORITY} to win`}
        />
      </div>
      {uncalled > 0 ? (
        <div className="mt-2 text-[10px] text-[var(--psc-muted)]">
          {uncalled} EV still uncalled (no votes or campaign activity in those states yet).
        </div>
      ) : null}
    </div>
  );
}

function CandList({
  list,
  align = "left",
}: {
  list: Array<{ id: string; name: string; ev: number; party: string }>;
  align?: "left" | "right";
}) {
  if (list.length === 0) return null;
  return (
    <ul
      className={`mt-1 space-y-0.5 text-[11px] text-[var(--psc-muted)] ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {list.map((c) => (
        <li key={c.id} className="font-mono tabular-nums">
          {c.name} · {c.ev}
        </li>
      ))}
    </ul>
  );
}
