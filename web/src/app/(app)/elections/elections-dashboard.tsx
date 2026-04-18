"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type DashboardElection = {
  id: string;
  office: "house" | "senate" | "president" | string;
  phase: "filing" | "primary" | "general" | "closed" | string;
  filing_opens_at: string;
  filing_closes_at: string;
  primary_closes_at: string;
  general_closes_at: string;
  district_code: string | null;
  state: string | null;
  senate_class: number | null;
  candidate_count: number;
};

type Props = {
  elections: DashboardElection[];
  userDistrict: string | null;
  userState: string | null;
  archiveCount: number;
};

const PHASES = ["filing", "primary", "general"] as const;
const OFFICES = ["house", "senate", "president"] as const;

type Phase = (typeof PHASES)[number];
type Office = (typeof OFFICES)[number];

const OFFICE_LABEL: Record<Office, string> = {
  house: "House",
  senate: "Senate",
  president: "President",
};

const OFFICE_DESCRIPTION: Record<Office, string> = {
  house: "District races",
  senate: "State races by class",
  president: "Nationwide race",
};

const PHASE_LABEL: Record<Phase, string> = {
  filing: "Filing",
  primary: "Primary",
  general: "General",
};

function phaseTone(phase: string) {
  switch (phase) {
    case "filing":
      return {
        pill: "bg-amber-100 text-amber-900 border-amber-300",
        dot: "bg-amber-500",
      };
    case "primary":
      return {
        pill: "bg-blue-100 text-blue-900 border-blue-300",
        dot: "bg-blue-600",
      };
    case "general":
      return {
        pill: "bg-violet-100 text-violet-900 border-violet-300",
        dot: "bg-violet-600",
      };
    case "closed":
      return {
        pill: "bg-emerald-100 text-emerald-900 border-emerald-300",
        dot: "bg-emerald-600",
      };
    default:
      return {
        pill: "bg-slate-100 text-slate-900 border-slate-300",
        dot: "bg-slate-500",
      };
  }
}

function phaseDeadline(e: DashboardElection): string | null {
  switch (e.phase) {
    case "filing":
      return e.filing_closes_at;
    case "primary":
      return e.primary_closes_at;
    case "general":
      return e.general_closes_at;
    default:
      return null;
  }
}

function countdown(e: DashboardElection): string | null {
  const target = phaseDeadline(e);
  if (!target) return null;
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return "finalizing…";
  const hours = Math.floor(diff / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);
  if (days >= 2) return `${days}d`;
  if (hours >= 2) return `${hours}h`;
  const minutes = Math.max(1, Math.floor(diff / (60 * 1000)));
  return `${minutes}m`;
}

function seatLabel(e: DashboardElection): string {
  if (e.office === "president") return "Nationwide";
  if (e.office === "senate") {
    const cls = e.senate_class ? ` · Class ${e.senate_class}` : "";
    return `${e.state ?? "—"}${cls}`;
  }
  return e.district_code ?? e.state ?? "—";
}

function searchBlob(e: DashboardElection): string {
  return [
    e.office,
    e.phase,
    e.district_code ?? "",
    e.state ?? "",
    e.senate_class ? `class ${e.senate_class}` : "",
    OFFICE_LABEL[e.office as Office] ?? e.office,
  ]
    .join(" ")
    .toLowerCase();
}

function stateFor(e: DashboardElection): string | null {
  if (e.office === "president") return null;
  if (e.state) return e.state;
  if (e.district_code) return e.district_code.slice(0, 2);
  return null;
}

function isMyRace(
  e: DashboardElection,
  userDistrict: string | null,
  userState: string | null,
): boolean {
  if (e.office === "president") return true;
  if (e.office === "house" && userDistrict) {
    return e.district_code?.toUpperCase() === userDistrict.toUpperCase();
  }
  if (e.office === "senate" && userState) {
    return (e.state ?? "").toUpperCase() === userState.toUpperCase();
  }
  return false;
}

/** Compact inline tile used inside the state row — whole surface is a link. */
function RaceChip({ e }: { e: DashboardElection }) {
  const tone = phaseTone(e.phase);
  const label = seatLabel(e);
  const cd = countdown(e);
  return (
    <Link
      href={`/elections/${e.id}`}
      className="group flex min-w-0 items-center gap-2 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-2.5 py-1.5 text-xs shadow-sm transition hover:border-[var(--psc-accent)] hover:shadow"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
      <span className="truncate font-mono text-[11px] font-semibold text-[var(--psc-ink)]">
        {label}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-[var(--psc-muted)]">
        {e.candidate_count}
      </span>
      {cd ? (
        <span className="shrink-0 font-mono text-[10px] text-[var(--psc-muted)]">
          · {cd}
        </span>
      ) : null}
    </Link>
  );
}

/** Large hero tile used under "Your races" — more visual real estate. */
function YourRaceCard({ e }: { e: DashboardElection }) {
  const tone = phaseTone(e.phase);
  return (
    <Link
      href={`/elections/${e.id}`}
      className="flex h-full min-w-0 flex-col justify-between gap-3 rounded-lg border-2 border-[var(--psc-accent)]/40 bg-[var(--psc-panel)] p-4 shadow-sm transition hover:border-[var(--psc-accent)] hover:shadow-md"
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone.pill}`}
          >
            {e.phase}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            {OFFICE_LABEL[e.office as Office] ?? e.office}
          </span>
        </div>
        <p className="truncate text-lg font-semibold text-[var(--psc-ink)]">
          {seatLabel(e)}
        </p>
      </div>
      <div className="flex items-center justify-between text-xs text-[var(--psc-muted)]">
        <span>
          {e.candidate_count} {e.candidate_count === 1 ? "candidate" : "candidates"}
        </span>
        <span className="font-mono">
          {countdown(e) ? `closes in ${countdown(e)}` : ""}
        </span>
      </div>
    </Link>
  );
}

function StateRow({ state, races }: { state: string; races: DashboardElection[] }) {
  const byPhase = new Map<string, number>();
  for (const r of races) byPhase.set(r.phase, (byPhase.get(r.phase) ?? 0) + 1);

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 border-t border-[var(--psc-border)]/60 py-2 first:border-t-0">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 min-w-[2.25rem] items-center justify-center rounded bg-[var(--psc-canvas)] px-2 font-mono text-xs font-bold uppercase tracking-wide text-[var(--psc-ink)]">
          {state}
        </span>
        <span className="font-mono text-[10px] text-[var(--psc-muted)]">
          {races.length}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {races.map((r) => (
          <RaceChip key={r.id} e={r} />
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
        active
          ? "border-[var(--psc-ink)] bg-[var(--psc-ink)] text-white"
          : "border-[var(--psc-border)] bg-[var(--psc-panel)] text-[var(--psc-ink)] hover:border-[var(--psc-accent)]"
      }`}
    >
      <span>{children}</span>
      {typeof count === "number" ? (
        <span
          className={`rounded-full px-1.5 font-mono text-[10px] ${
            active ? "bg-white/20 text-white" : "bg-[var(--psc-canvas)] text-[var(--psc-muted)]"
          }`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

export function ElectionsDashboard({
  elections,
  userDistrict,
  userState,
  archiveCount,
}: Props) {
  const [query, setQuery] = useState("");
  const [phaseFilter, setPhaseFilter] = useState<Phase | "all">("all");
  const [officeFilter, setOfficeFilter] = useState<Office | "all">("all");

  const myRaces = useMemo(
    () => elections.filter((e) => isMyRace(e, userDistrict, userState)),
    [elections, userDistrict, userState],
  );

  const phaseCounts: Record<Phase, number> = { filing: 0, primary: 0, general: 0 };
  const officeCounts: Record<Office, number> = { house: 0, senate: 0, president: 0 };
  for (const e of elections) {
    if ((PHASES as readonly string[]).includes(e.phase)) {
      phaseCounts[e.phase as Phase]++;
    }
    if ((OFFICES as readonly string[]).includes(e.office)) {
      officeCounts[e.office as Office]++;
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return elections.filter((e) => {
      if (phaseFilter !== "all" && e.phase !== phaseFilter) return false;
      if (officeFilter !== "all" && e.office !== officeFilter) return false;
      if (q && !searchBlob(e).includes(q)) return false;
      return true;
    });
  }, [elections, query, phaseFilter, officeFilter]);

  const grouped = useMemo(() => {
    const byOffice = new Map<Office, DashboardElection[]>();
    for (const e of filtered) {
      const key = (e.office as Office) ?? "house";
      if (!OFFICES.includes(key)) continue;
      const list = byOffice.get(key) ?? [];
      list.push(e);
      byOffice.set(key, list);
    }
    return byOffice;
  }, [filtered]);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Elections</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--psc-muted)]">
            {elections.length} active race{elections.length === 1 ? "" : "s"} across House,
            Senate, and President. Search, filter, or jump straight to your own ballot.
          </p>
        </div>
        <Link
          href="/elections/archive"
          className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)] hover:border-[var(--psc-accent)]"
        >
          Archive ({archiveCount})
        </Link>
      </header>

      {myRaces.length ? (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
              Your ballot
            </h2>
            <span className="text-[10px] text-[var(--psc-muted)]">
              Matched to your district {userDistrict ? `(${userDistrict})` : ""} and state{" "}
              {userState ? `(${userState})` : ""}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {myRaces.map((e) => (
              <YourRaceCard key={e.id} e={e} />
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-4 text-xs text-[var(--psc-muted)]">
          Set your <Link href="/character" className="font-semibold text-[var(--psc-accent)] underline">Character</Link>{" "}
          home district and residence state to pin your own races at the top.
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Search state, district (e.g. CA-12)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-2 text-sm outline-none focus:border-[var(--psc-accent)] sm:min-w-[18rem] sm:flex-initial"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-2 py-1 text-xs text-[var(--psc-muted)] hover:border-[var(--psc-accent)]"
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
            Phase
          </span>
          <FilterChip
            active={phaseFilter === "all"}
            onClick={() => setPhaseFilter("all")}
            count={phaseCounts.filing + phaseCounts.primary + phaseCounts.general}
          >
            All
          </FilterChip>
          {PHASES.map((p) => (
            <FilterChip
              key={p}
              active={phaseFilter === p}
              onClick={() => setPhaseFilter(p)}
              count={phaseCounts[p]}
            >
              {PHASE_LABEL[p]}
            </FilterChip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
            Chamber
          </span>
          <FilterChip
            active={officeFilter === "all"}
            onClick={() => setOfficeFilter("all")}
            count={officeCounts.house + officeCounts.senate + officeCounts.president}
          >
            All
          </FilterChip>
          {OFFICES.map((o) => (
            <FilterChip
              key={o}
              active={officeFilter === o}
              onClick={() => setOfficeFilter(o)}
              count={officeCounts[o]}
            >
              {OFFICE_LABEL[o]}
            </FilterChip>
          ))}
        </div>
      </section>

      {!filtered.length ? (
        <section className="border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-6 text-center text-sm text-[var(--psc-muted)]">
          No races match your filters.
        </section>
      ) : (
        <div className="space-y-6">
          {OFFICES.map((office) => {
            const rows = grouped.get(office);
            if (!rows?.length) return null;

            const description = OFFICE_DESCRIPTION[office];

            if (office === "president") {
              return (
                <details
                  key={office}
                  open
                  className="group rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-base font-semibold text-[var(--psc-ink)]">
                        {OFFICE_LABEL[office]}
                      </span>
                      <span className="text-xs text-[var(--psc-muted)]">
                        {description}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-[var(--psc-muted)]">
                      {rows.length}
                    </span>
                  </summary>
                  <div className="flex flex-wrap gap-1.5 border-t border-[var(--psc-border)] p-4">
                    {rows.map((r) => (
                      <RaceChip key={r.id} e={r} />
                    ))}
                  </div>
                </details>
              );
            }

            const byState = new Map<string, DashboardElection[]>();
            for (const r of rows) {
              const st = stateFor(r) ?? "??";
              const list = byState.get(st) ?? [];
              list.push(r);
              byState.set(st, list);
            }
            const sortedStates = [...byState.entries()].sort((a, b) =>
              a[0].localeCompare(b[0]),
            );

            return (
              <details
                key={office}
                open
                className="group rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-semibold text-[var(--psc-ink)]">
                      {OFFICE_LABEL[office]}
                    </span>
                    <span className="text-xs text-[var(--psc-muted)]">{description}</span>
                  </div>
                  <span className="font-mono text-xs text-[var(--psc-muted)]">
                    {rows.length} · {sortedStates.length} state
                    {sortedStates.length === 1 ? "" : "s"}
                  </span>
                </summary>
                <div className="border-t border-[var(--psc-border)] p-4">
                  {sortedStates.map(([st, races]) => (
                    <StateRow
                      key={st}
                      state={st}
                      races={[...races].sort((a, b) => {
                        const ac = a.district_code ?? a.state ?? "";
                        const bc = b.district_code ?? b.state ?? "";
                        return ac.localeCompare(bc);
                      })}
                    />
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
