import { updateDefenseTheaterPosture } from "@/app/actions/cabinet-defense-theater";
import { SubmitButton } from "@/components/submit-button";
import {
  DEFENSE_FOCUS_STYLE_OPTIONS,
  defaultFocusStyleIdForMechanism,
} from "@/lib/defense-theater";

export type TheaterDirectiveRow = {
  nation_code: string;
  name: string;
  us_relation: number;
  priority_tier: number;
  forward_presence_level: number;
  primary_mechanism: string;
  theater_brief: string;
  updated_at: string | null;
};

const TIER_GAME: Record<1 | 2 | 3, string> = {
  1: "Hot spot",
  2: "On watch",
  3: "Back burner",
};

function sortRows(rows: TheaterDirectiveRow[]): TheaterDirectiveRow[] {
  return [...rows].sort((a, b) => {
    if (a.priority_tier !== b.priority_tier) return a.priority_tier - b.priority_tier;
    if (b.forward_presence_level !== a.forward_presence_level) return b.forward_presence_level - a.forward_presence_level;
    return a.name.localeCompare(b.name);
  });
}

function CountryCard({ row, canAct }: { row: TheaterDirectiveRow; canAct: boolean }) {
  const diplomacy = Math.max(0, Math.min(100, row.us_relation));
  const defaultFocus = defaultFocusStyleIdForMechanism(row.primary_mechanism);
  const tier = row.priority_tier === 1 || row.priority_tier === 2 || row.priority_tier === 3 ? row.priority_tier : 3;

  return (
    <li className="flex flex-col rounded-xl border border-[var(--psc-border)] bg-white/50 p-4 shadow-sm backdrop-blur-[2px]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-[var(--psc-ink)]">{row.name}</p>
          <p className="text-xs text-[var(--psc-muted)]">Diplomacy mood (State) · {diplomacy}/100</p>
        </div>
        <span className="rounded-full border border-emerald-800/20 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">
          {TIER_GAME[tier]}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-rose-400/80 via-amber-300/90 to-emerald-500/90"
          style={{ width: `${diplomacy}%` }}
        />
      </div>
      {row.theater_brief ? (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--psc-muted)]">{row.theater_brief}</p>
      ) : null}

      {canAct ? (
        <form action={updateDefenseTheaterPosture} className="mt-3 space-y-3 border-t border-[var(--psc-border)] pt-3">
          <input type="hidden" name="nation_code" value={row.nation_code} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--psc-muted)]">
              How urgent?
              <select
                name="priority_tier"
                defaultValue={String(tier)}
                className="rounded-lg border border-[var(--psc-border)] bg-white px-2 py-2 text-sm text-[var(--psc-ink)]"
              >
                {([1, 2, 3] as const).map((t) => (
                  <option key={t} value={t}>
                    {TIER_GAME[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--psc-muted)]">
              Presence meter (0 = barely there, 100 = max)
              <input
                type="range"
                name="forward_presence_level"
                min={0}
                max={100}
                defaultValue={row.forward_presence_level}
                className="w-full accent-emerald-600"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--psc-muted)]">
            What are we doing?
            <select
              name="focus_style"
              defaultValue={defaultFocus}
              className="rounded-lg border border-[var(--psc-border)] bg-white px-2 py-2 text-sm text-[var(--psc-ink)]"
            >
              {DEFENSE_FOCUS_STYLE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--psc-muted)]">
            Notes (optional, for RP)
            <input
              type="text"
              name="theater_brief"
              maxLength={4000}
              defaultValue={row.theater_brief}
              placeholder="e.g. Extra port visits this quarter"
              className="rounded-lg border border-[var(--psc-border)] bg-white px-2 py-2 text-sm text-[var(--psc-ink)]"
            />
          </label>
          <SubmitButton className="w-full rounded-lg border-2 border-emerald-700/40 bg-emerald-600/15 px-3 py-2 text-sm font-bold text-emerald-950 hover:bg-emerald-600/25">
            Save this country
          </SubmitButton>
        </form>
      ) : null}
    </li>
  );
}

export function DefenseTheaterDirectivesPanel({
  rows,
  canAct,
}: {
  rows: TheaterDirectiveRow[];
  canAct: boolean;
}) {
  const sorted = sortRows(rows);
  const spotlight = sorted.slice(0, 10);
  const rest = sorted.slice(10);

  return (
    <section className="rounded-2xl border border-[var(--psc-border)] bg-white/30 p-5 shadow-sm backdrop-blur-sm">
      <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Global focus board</h2>
      <p className="mt-1 max-w-2xl text-sm text-[var(--psc-muted)]">
        Slide how much attention each place gets. “What we are doing” is the movie-style mission flavor — the sim still
        tracks the serious tags under the hood. State keeps the diplomacy score; you steer where uniforms and gear show
        up for RP.
      </p>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {spotlight.map((row) => (
          <CountryCard key={row.nation_code} row={row} canAct={canAct} />
        ))}
      </ul>

      {rest.length > 0 ? (
        <details className="mt-4 rounded-xl border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/40 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--psc-ink)]">
            Show all countries ({rest.length} more)
          </summary>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rest.map((row) => (
              <CountryCard key={row.nation_code} row={row} canAct={canAct} />
            ))}
          </ul>
        </details>
      ) : null}

      {!canAct ? (
        <p className="mt-4 rounded-lg border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-3 text-sm text-[var(--psc-muted)]">
          Only the Secretary of Defense can edit the focus board. Everyone else sees the map for briefings.
        </p>
      ) : null}
    </section>
  );
}
