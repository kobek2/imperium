"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { leadershipRoleLabel, type LeadershipRole } from "@/lib/leadership";

export type AdminElectionRow = {
  id: string;
  office: "house" | "senate" | "president" | string;
  phase: "filing" | "primary" | "general" | "closed" | string;
  state: string | null;
  district_code: string | null;
  senate_class: number | null;
  filing_opens_at: string;
  filing_closes_at: string;
  primary_closes_at: string | null;
  general_closes_at: string;
  leadership_role: string | null;
  restricted_party: string | null;
  filing_window_started_at?: string | null;
  candidate_count: number;
};

const PHASES = ["filing", "primary", "general", "closed"] as const;
const OFFICES = ["house", "senate", "president", "leadership"] as const;

type Phase = (typeof PHASES)[number];
type Office = (typeof OFFICES)[number];

const OFFICE_LABEL: Record<Office, string> = {
  house: "House",
  senate: "Senate",
  president: "President",
  leadership: "Leadership",
};

function bucketFor(r: AdminElectionRow): Office | null {
  if (r.leadership_role) return "leadership";
  if ((OFFICES as readonly string[]).includes(r.office)) return r.office as Office;
  return null;
}

const PHASE_LABEL: Record<Phase, string> = {
  filing: "Filing",
  primary: "Primary",
  general: "General",
  closed: "Closed",
};

function phaseTone(phase: string) {
  switch (phase) {
    case "filing":
      return "bg-amber-500";
    case "primary":
      return "bg-blue-600";
    case "general":
      return "bg-violet-600";
    case "closed":
      return "bg-emerald-600";
    default:
      return "bg-slate-500";
  }
}

function phaseDeadline(r: AdminElectionRow) {
  switch (r.phase) {
    case "filing":
      return r.filing_closes_at;
    case "primary":
      return r.primary_closes_at;
    case "general":
      return r.general_closes_at;
    default:
      return null;
  }
}

function countdown(r: AdminElectionRow) {
  if (r.phase === "filing" && !r.leadership_role && !r.filing_window_started_at) {
    return null;
  }
  const target = phaseDeadline(r);
  if (!target) return null;
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return "past";
  const hours = Math.floor(diff / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);
  if (days >= 2) return `${days}d`;
  if (hours >= 2) return `${hours}h`;
  const minutes = Math.max(1, Math.floor(diff / (60 * 1000)));
  return `${minutes}m`;
}

function seatLabel(r: AdminElectionRow): string {
  if (r.leadership_role) {
    const label = leadershipRoleLabel(r.leadership_role as LeadershipRole);
    return r.restricted_party ? `${label} · ${r.restricted_party}` : label;
  }
  if (r.office === "president") return "Nationwide";
  if (r.office === "senate") {
    const cls = r.senate_class ? ` · C${r.senate_class}` : "";
    return `${r.state ?? "—"}${cls}`;
  }
  return r.district_code ?? r.state ?? "—";
}

function stateFor(r: AdminElectionRow): string | null {
  if (r.leadership_role) return null;
  if (r.office === "president") return null;
  if (r.state) return r.state;
  if (r.district_code) return r.district_code.slice(0, 2);
  return null;
}

function searchBlob(r: AdminElectionRow): string {
  return [
    r.office,
    r.phase,
    r.district_code ?? "",
    r.state ?? "",
    r.senate_class ? `class ${r.senate_class}` : "",
    r.leadership_role ?? "",
    r.restricted_party ?? "",
    r.leadership_role
      ? leadershipRoleLabel(r.leadership_role as LeadershipRole)
      : "",
    OFFICE_LABEL[r.office as Office] ?? r.office,
  ]
    .join(" ")
    .toLowerCase();
}

function OperateChip({ r }: { r: AdminElectionRow }) {
  const cd = countdown(r);
  return (
    <Link
      href={`/admin/elections/${r.id}`}
      className="group flex min-w-0 items-center gap-2 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-2.5 py-1.5 text-xs shadow-sm transition hover:border-[var(--psc-accent)] hover:shadow"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${phaseTone(r.phase)}`} />
      <span className="truncate font-mono text-[11px] font-semibold text-[var(--psc-ink)]">
        {seatLabel(r)}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-[var(--psc-muted)]">
        {r.candidate_count}c
      </span>
      {r.phase === "filing" && !r.leadership_role && !r.filing_window_started_at ? (
        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-amber-950">
          dormant
        </span>
      ) : cd ? (
        <span className="shrink-0 font-mono text-[10px] text-[var(--psc-muted)]">
          · {cd}
        </span>
      ) : null}
    </Link>
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

export function AdminElectionsList({
  rows,
  view = "active",
}: {
  rows: AdminElectionRow[];
  view?: "active" | "archive";
}) {
  const archiveOnly = view === "archive";
  const [query, setQuery] = useState("");
  const [phaseFilter, setPhaseFilter] = useState<Phase | "all">("all");
  const [officeFilter, setOfficeFilter] = useState<Office | "all">("all");
  const [showClosed, setShowClosed] = useState(false);

  const countRows = archiveOnly ? rows.filter((r) => r.phase === "closed") : rows;

  const phaseCounts: Record<Phase, number> = {
    filing: 0,
    primary: 0,
    general: 0,
    closed: 0,
  };
  const officeCounts: Record<Office, number> = {
    house: 0,
    senate: 0,
    president: 0,
    leadership: 0,
  };
  for (const r of countRows) {
    if ((PHASES as readonly string[]).includes(r.phase)) {
      phaseCounts[r.phase as Phase]++;
    }
    const bucket = bucketFor(r);
    if (bucket) officeCounts[bucket]++;
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (archiveOnly) {
        if (r.phase !== "closed") return false;
      } else if (!showClosed && r.phase === "closed") {
        return false;
      }
      if (phaseFilter !== "all" && r.phase !== phaseFilter) return false;
      if (officeFilter !== "all" && bucketFor(r) !== officeFilter) return false;
      if (q && !searchBlob(r).includes(q)) return false;
      return true;
    });
  }, [rows, query, phaseFilter, officeFilter, showClosed, archiveOnly]);

  const grouped = useMemo(() => {
    const byOffice = new Map<Office, AdminElectionRow[]>();
    for (const r of filtered) {
      const key = bucketFor(r);
      if (!key) continue;
      const list = byOffice.get(key) ?? [];
      list.push(r);
      byOffice.set(key, list);
    }
    return byOffice;
  }, [filtered]);

  const hasAnyClosed = useMemo(() => rows.some((r) => r.phase === "closed"), [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-[var(--psc-ink)]">
          {archiveOnly ? "Archived elections" : "Elections"}
        </h2>
        <div className="flex items-center gap-2">
          {!archiveOnly ? (
            <label className="flex items-center gap-2 text-xs text-[var(--psc-muted)]">
              <input
                type="checkbox"
                checked={showClosed}
                onChange={(e) => setShowClosed(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Show closed ({phaseCounts.closed})
            </label>
          ) : null}
          <Link
            href="/admin/elections/new"
            className="admin-cardlink border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white hover:brightness-110 active:brightness-90"
          >
            New race
          </Link>
        </div>
      </div>

      {!rows.length ? (
        <p className="text-sm text-[var(--psc-muted)]">
          No elections yet. Create one to get started.
        </p>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                placeholder="Search state, district (e.g. CA-12)…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 flex-1 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-2 text-sm outline-none focus:border-[var(--psc-accent)] sm:min-w-[20rem] sm:flex-initial"
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

            {!archiveOnly ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
                  Phase
                </span>
                <FilterChip
                  active={phaseFilter === "all"}
                  onClick={() => setPhaseFilter("all")}
                  count={
                    phaseCounts.filing +
                    phaseCounts.primary +
                    phaseCounts.general +
                    (showClosed ? phaseCounts.closed : 0)
                  }
                >
                  All
                </FilterChip>
                {PHASES.filter((p) => p !== "closed" || showClosed).map((p) => (
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
            ) : (
              <p className="text-xs text-[var(--psc-muted)]">
                Closed races only. Open a row for full results; the public Elections page lists active
                races.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
                Chamber
              </span>
              <FilterChip
                active={officeFilter === "all"}
                onClick={() => setOfficeFilter("all")}
                count={
                  officeCounts.house +
                  officeCounts.senate +
                  officeCounts.president +
                  officeCounts.leadership
                }
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
            <p className="border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-6 text-center text-sm text-[var(--psc-muted)]">
              {archiveOnly && !hasAnyClosed
                ? "No closed elections yet. Finished races appear here once their phase is closed."
                : archiveOnly
                  ? "No archived races match your filters."
                  : "No races match your filters."}
            </p>
          ) : (
            <div className="space-y-4">
              {OFFICES.map((office) => {
                const list = grouped.get(office);
                if (!list?.length) return null;

                if (office === "president" || office === "leadership") {
                  return (
                    <details
                      key={office}
                      open
                      className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]"
                    >
                      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
                        <span className="text-base font-semibold text-[var(--psc-ink)]">
                          {OFFICE_LABEL[office]}
                        </span>
                        <span className="font-mono text-xs text-[var(--psc-muted)]">
                          {list.length}
                        </span>
                      </summary>
                      <div className="flex flex-wrap gap-1.5 border-t border-[var(--psc-border)] p-4">
                        {list.map((r) => (
                          <OperateChip key={r.id} r={r} />
                        ))}
                      </div>
                    </details>
                  );
                }

                const byState = new Map<string, AdminElectionRow[]>();
                for (const r of list) {
                  const st = stateFor(r) ?? "??";
                  const arr = byState.get(st) ?? [];
                  arr.push(r);
                  byState.set(st, arr);
                }
                const sortedStates = [...byState.entries()].sort((a, b) =>
                  a[0].localeCompare(b[0]),
                );

                return (
                  <details
                    key={office}
                    open
                    className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]"
                  >
                    <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
                      <span className="text-base font-semibold text-[var(--psc-ink)]">
                        {OFFICE_LABEL[office]}
                      </span>
                      <span className="font-mono text-xs text-[var(--psc-muted)]">
                        {list.length} · {sortedStates.length} state
                        {sortedStates.length === 1 ? "" : "s"}
                      </span>
                    </summary>
                    <div className="divide-y divide-[var(--psc-border)]/60 border-t border-[var(--psc-border)]">
                      {sortedStates.map(([st, races]) => (
                        <div
                          key={st}
                          className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 px-4 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-7 min-w-[2.25rem] items-center justify-center rounded bg-[var(--psc-canvas)] px-2 font-mono text-xs font-bold uppercase tracking-wide text-[var(--psc-ink)]">
                              {st}
                            </span>
                            <span className="font-mono text-[10px] text-[var(--psc-muted)]">
                              {races.length}
                            </span>
                          </div>
                          <div className="flex min-w-0 flex-wrap gap-1.5">
                            {[...races]
                              .sort((a, b) => {
                                const ac = a.district_code ?? a.state ?? "";
                                const bc = b.district_code ?? b.state ?? "";
                                return ac.localeCompare(bc);
                              })
                              .map((r) => (
                                <OperateChip key={r.id} r={r} />
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
