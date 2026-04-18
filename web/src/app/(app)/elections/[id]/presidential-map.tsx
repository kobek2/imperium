"use client";

/**
 * Tile-cartogram map of the US for presidential races. Each state is a small square in a
 * fixed grid position that loosely matches its real-world geography (NYT / NPR style).
 *
 * We use a cartogram instead of a geographic SVG because (a) it gives equal visual weight
 * to small dense states like RI/DE/DC that would be invisible on a real map, and (b) we
 * don't need to ship megabytes of topojson for it.
 *
 * Coloring:
 *   - If a state has no in-state votes and no raw speech/rally points there yet, we color
 *     by the state's stored 2024 margin (so tiles match the pre-campaign baseline).
 *   - After local activity exists, we color by the projected winner's party and shade by
 *     their lead over second place in the blended score.
 *
 * Hovering a tile pops up a panel with per-candidate points / votes / projected share.
 */

import { useMemo, useState } from "react";
import type { PresidentialResult, StateResult } from "@/lib/presidential-scoring";

type CandidateBrief = {
  id: string;
  user_id: string;
  party: string;
  name: string;
};

type Props = {
  states: Array<{ code: string; name: string; pvi: number; electoral_votes: number }>;
  result: PresidentialResult | null;
  candidates: CandidateBrief[];
};

// Grid cartogram: roughly geographic (row, col) tile positions.
// 8 rows (0=top), 13 cols (0=left). Picked to match the common US tile map layout.
const STATE_POS: Record<string, { row: number; col: number }> = {
  ME: { row: 0, col: 11 },
  VT: { row: 1, col: 10 },
  NH: { row: 1, col: 11 },
  WA: { row: 2, col: 1 },
  ID: { row: 2, col: 2 },
  MT: { row: 2, col: 3 },
  ND: { row: 2, col: 4 },
  MN: { row: 2, col: 5 },
  WI: { row: 2, col: 6 },
  MI: { row: 2, col: 8 },
  NY: { row: 2, col: 9 },
  MA: { row: 2, col: 10 },
  AK: { row: 2, col: 0 },
  OR: { row: 3, col: 1 },
  NV: { row: 3, col: 2 },
  WY: { row: 3, col: 3 },
  SD: { row: 3, col: 4 },
  IA: { row: 3, col: 5 },
  IL: { row: 3, col: 6 },
  IN: { row: 3, col: 7 },
  OH: { row: 3, col: 8 },
  PA: { row: 3, col: 9 },
  NJ: { row: 3, col: 10 },
  CT: { row: 3, col: 11 },
  RI: { row: 3, col: 12 },
  CA: { row: 4, col: 1 },
  UT: { row: 4, col: 2 },
  CO: { row: 4, col: 3 },
  NE: { row: 4, col: 4 },
  MO: { row: 4, col: 5 },
  KY: { row: 4, col: 6 },
  WV: { row: 4, col: 7 },
  VA: { row: 4, col: 8 },
  MD: { row: 4, col: 9 },
  DE: { row: 4, col: 10 },
  AZ: { row: 5, col: 2 },
  NM: { row: 5, col: 3 },
  KS: { row: 5, col: 4 },
  AR: { row: 5, col: 5 },
  TN: { row: 5, col: 6 },
  NC: { row: 5, col: 7 },
  SC: { row: 5, col: 8 },
  DC: { row: 5, col: 9 },
  OK: { row: 6, col: 4 },
  LA: { row: 6, col: 5 },
  MS: { row: 6, col: 6 },
  AL: { row: 6, col: 7 },
  GA: { row: 6, col: 8 },
  HI: { row: 7, col: 0 },
  TX: { row: 7, col: 4 },
  FL: { row: 7, col: 8 },
};

const GRID_ROWS = 8;
const GRID_COLS = 13;

function pviTone(pvi: number) {
  // Signed 2024 presidential margin (D+ / R+). Matches `states.pvi` seed data.
  if (pvi >= 15) return "bg-blue-700 text-white";
  if (pvi >= 6) return "bg-blue-500 text-white";
  if (pvi >= 2) return "bg-blue-300 text-blue-950";
  if (pvi > -2) return "bg-slate-200 text-slate-900";
  if (pvi > -6) return "bg-red-300 text-red-950";
  if (pvi > -15) return "bg-red-500 text-white";
  return "bg-red-700 text-white";
}

function partyShade(party: string, leadMargin: number) {
  // leadMargin is the winning candidate's score minus the runner-up's score. 0-1 scale.
  const m = Math.max(0, Math.min(1, leadMargin));
  if (party === "democrat") {
    if (m >= 0.2) return "bg-blue-700 text-white";
    if (m >= 0.08) return "bg-blue-500 text-white";
    return "bg-blue-300 text-blue-950";
  }
  if (party === "republican") {
    if (m >= 0.2) return "bg-red-700 text-white";
    if (m >= 0.08) return "bg-red-500 text-white";
    return "bg-red-300 text-red-950";
  }
  if (party === "independent") {
    if (m >= 0.2) return "bg-emerald-700 text-white";
    if (m >= 0.08) return "bg-emerald-500 text-white";
    return "bg-emerald-300 text-emerald-950";
  }
  return "bg-slate-300 text-slate-900";
}

function pviLabel(pvi: number) {
  if (pvi > 0) return `D +${Math.round(pvi)}`;
  if (pvi < 0) return `R +${Math.round(-pvi)}`;
  return "Even";
}

function partyLabel(p: string) {
  if (p === "democrat") return "Democratic";
  if (p === "republican") return "Republican";
  if (p === "independent") return "Independent";
  return p || "Unaffiliated";
}

function topTwoMargin(state: StateResult | undefined): number {
  if (!state || state.scores.length === 0) return 0;
  const sorted = [...state.scores].sort((a, b) => b.score - a.score);
  if (sorted.length === 1) return 1;
  return (sorted[0]!.score - sorted[1]!.score);
}

export function PresidentialMap({ states, result, candidates }: Props) {
  const [hoverCode, setHoverCode] = useState<string | null>(null);

  const stateByCode = useMemo(() => {
    const m = new Map<string, Props["states"][number]>();
    for (const s of states) m.set(s.code.toUpperCase(), s);
    return m;
  }, [states]);

  const candById = useMemo(() => {
    const m = new Map<string, CandidateBrief>();
    for (const c of candidates) m.set(c.id, c);
    return m;
  }, [candidates]);

  // Build a code -> tile render for the grid. We iterate rows/cols so empty cells still
  // occupy space and the geography lines up.
  const tilesByKey = new Map<string, string>();
  for (const [code, pos] of Object.entries(STATE_POS)) {
    tilesByKey.set(`${pos.row}:${pos.col}`, code);
  }

  const activeHover = hoverCode ? stateByCode.get(hoverCode) : null;
  const hoverResult = hoverCode ? result?.byState[hoverCode] : null;

  return (
    <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-ink)]">
          Electoral college map
        </h3>
        <div className="flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 bg-blue-700" /> Safe D</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 bg-blue-300" /> Lean D</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 bg-slate-200" /> Tossup</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 bg-red-300" /> Lean R</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 bg-red-700" /> Safe R</span>
        </div>
      </div>
      <div className="mt-3 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
        <div
          className="grid gap-1"
          style={{
            gridTemplateRows: `repeat(${GRID_ROWS}, minmax(0, 1fr))`,
            gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
          }}
          onMouseLeave={() => setHoverCode(null)}
        >
          {Array.from({ length: GRID_ROWS * GRID_COLS }).map((_, idx) => {
            const row = Math.floor(idx / GRID_COLS);
            const col = idx % GRID_COLS;
            const code = tilesByKey.get(`${row}:${col}`);
            if (!code) return <div key={`e-${idx}`} />;
            const meta = stateByCode.get(code);
            if (!meta) return <div key={`m-${idx}`} />;

            const stateRes = result?.byState[code];
            const winnerId = stateRes?.winner_candidate_id ?? null;
            const winnerCand = winnerId ? candById.get(winnerId) : null;
            const hasActivity =
              stateRes != null &&
              (stateRes.raw_points_total > 0 || stateRes.total_votes > 0);

            const tone = hasActivity && winnerCand
              ? partyShade(winnerCand.party, topTwoMargin(stateRes))
              : pviTone(meta.pvi);

            const isHover = hoverCode === code;
            return (
              <button
                key={code}
                type="button"
                onMouseEnter={() => setHoverCode(code)}
                onFocus={() => setHoverCode(code)}
                onClick={() => setHoverCode(code)}
                className={`relative aspect-square min-w-0 flex flex-col items-center justify-center rounded-sm text-[10px] font-bold leading-none transition ${tone} ${
                  isHover ? "ring-2 ring-offset-1 ring-[var(--psc-accent)] z-10" : ""
                }`}
                style={{
                  gridRow: row + 1,
                  gridColumn: col + 1,
                }}
                aria-label={`${meta.name}, ${meta.electoral_votes} electoral votes`}
              >
                <span>{code}</span>
                <span className="mt-0.5 text-[9px] opacity-90">{meta.electoral_votes}</span>
              </button>
            );
          })}
        </div>

        <div className="min-h-[220px] rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3 text-xs">
          {!activeHover ? (
            <div className="text-[var(--psc-muted)]">
              Hover a state to see its electoral votes, partisan lean, and projected winner.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-[var(--psc-ink)]">
                    {activeHover.name}
                  </div>
                  <div className="text-[var(--psc-muted)]">
                    {activeHover.code} · {activeHover.electoral_votes} EV · {pviLabel(activeHover.pvi)}
                  </div>
                </div>
                {hoverResult && hoverResult.winner_candidate_id ? (
                  <WinnerPill
                    cand={candById.get(hoverResult.winner_candidate_id) ?? null}
                    projected={
                      hoverResult.raw_points_total > 0 || hoverResult.total_votes > 0
                    }
                  />
                ) : null}
              </div>
              {hoverResult ? (
                <div className="space-y-1">
                  {[...hoverResult.scores]
                    .sort((a, b) => b.score - a.score)
                    .map((s) => {
                      const cand = candById.get(s.candidate_id);
                      if (!cand) return null;
                      return (
                        <div
                          key={s.candidate_id}
                          className="grid grid-cols-[1fr_auto] items-baseline gap-2 border-b border-dashed border-[var(--psc-border)] pb-1 last:border-none"
                        >
                          <div className="min-w-0 truncate">
                            <span
                              className={`mr-1 inline-block h-2 w-2 rounded-full align-middle ${
                                cand.party === "democrat"
                                  ? "bg-blue-600"
                                  : cand.party === "republican"
                                    ? "bg-red-600"
                                    : cand.party === "independent"
                                      ? "bg-emerald-600"
                                      : "bg-slate-500"
                              }`}
                            />
                            <span className="font-semibold text-[var(--psc-ink)]">{cand.name}</span>{" "}
                            <span className="text-[10px] text-[var(--psc-muted)]">
                              ({partyLabel(cand.party)})
                            </span>
                          </div>
                          <div className="font-mono text-[11px] tabular-nums text-[var(--psc-ink)]">
                            {(s.score * 100).toFixed(1)}%
                          </div>
                          <div className="col-span-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--psc-muted)]">
                            <span>pts {s.points_with_lean.toFixed(1)}</span>
                            <span>votes {s.votes}</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="text-[var(--psc-muted)]">
                  No campaign activity or votes yet. Lean: {pviLabel(activeHover.pvi)}.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WinnerPill({ cand, projected }: { cand: CandidateBrief | null; projected: boolean }) {
  if (!cand) return null;
  const color =
    cand.party === "democrat"
      ? "bg-blue-600 text-white"
      : cand.party === "republican"
        ? "bg-red-600 text-white"
        : cand.party === "independent"
          ? "bg-emerald-600 text-white"
          : "bg-slate-600 text-white";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${color}`}>
      {projected ? "Projected" : "Lean"}: {cand.name.split(" ")[0]}
    </span>
  );
}
