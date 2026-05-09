"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { RpDatePill } from "@/components/rp-date-pill";

export type DashboardElection = {
  id: string;
  office: "house" | "senate" | "president" | string;
  phase: "filing" | "primary" | "general" | "closed" | string;
  filing_opens_at: string;
  filing_closes_at: string;
  primary_closes_at: string | null;
  general_closes_at: string;
  district_code: string | null;
  state: string | null;
  senate_class: number | null;
  leadership_role: string | null;
  restricted_party: string | null;
  /** Null while a seat race is an admin-only dormant template (filings not opened). */
  filing_window_started_at?: string | null;
  candidate_count: number;
};

type Props = {
  elections: DashboardElection[];
  userDistrict: string | null;
  userState: string | null;
  rpDateLabel?: string | null;
};

import { leadershipRoleLabel, type LeadershipRole } from "@/lib/leadership";

const PHASES = ["filing", "primary", "general"] as const;
const OFFICES = ["house", "senate", "president", "leadership"] as const;

type Phase = (typeof PHASES)[number];
type Office = (typeof OFFICES)[number];

const OFFICE_LABEL: Record<Office, string> = {
  house: "House",
  senate: "Senate",
  president: "President",
  leadership: "Leadership",
};

/**
 * Logical bucket for a race: leadership races get their own "leadership" category regardless
 * of whether they're House- or Senate-scoped, so admins and voters can find them together.
 */
function officeBucket(e: DashboardElection): Office {
  if (e.leadership_role) return "leadership";
  return e.office as Office;
}

const PHASE_LABEL: Record<Phase, string> = {
  filing: "Filing",
  primary: "Primary",
  general: "General",
};

type PhaseStyle = {
  pill: string;
  dot: string;
  bar: string;
  cardAccent: string;
  badgeLabel: string;
};

function phaseStyle(phase: string): PhaseStyle {
  switch (phase) {
    case "filing":
      return {
        pill: "bg-amber-100 text-amber-900 border-amber-300",
        dot: "bg-amber-500",
        bar: "bg-amber-400",
        cardAccent: "hover:border-amber-400",
        badgeLabel: "Filing",
      };
    case "primary":
      return {
        pill: "bg-blue-100 text-blue-900 border-blue-300",
        dot: "bg-blue-600",
        bar: "bg-blue-500",
        cardAccent: "hover:border-blue-400",
        badgeLabel: "Primary",
      };
    case "general":
      return {
        pill: "bg-violet-100 text-violet-900 border-violet-300",
        dot: "bg-violet-600",
        bar: "bg-violet-500",
        cardAccent: "hover:border-violet-400",
        badgeLabel: "General",
      };
    case "closed":
      return {
        pill: "bg-emerald-100 text-emerald-900 border-emerald-300",
        dot: "bg-emerald-600",
        bar: "bg-emerald-500",
        cardAccent: "hover:border-emerald-400",
        badgeLabel: "Closed",
      };
    default:
      return {
        pill: "bg-slate-100 text-slate-900 border-slate-300",
        dot: "bg-slate-500",
        bar: "bg-slate-400",
        cardAccent: "hover:border-slate-400",
        badgeLabel: phase,
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

function countdown(e: DashboardElection): { text: string; urgent: boolean } | null {
  const target = phaseDeadline(e);
  if (!target) return null;
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return { text: "finalizing…", urgent: true };
  const minutes = Math.floor(diff / (60 * 1000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 2) return { text: `${days}d left`, urgent: false };
  if (hours >= 2) return { text: `${hours}h left`, urgent: hours < 6 };
  return { text: `${Math.max(1, minutes)}m left`, urgent: true };
}

function seatHeadline(e: DashboardElection): string {
  if (e.leadership_role) {
    return leadershipRoleLabel(e.leadership_role as LeadershipRole);
  }
  if (e.office === "president") return "President of the United States";
  if (e.office === "senate") {
    const cls = e.senate_class ? ` · Class ${e.senate_class}` : "";
    return `${e.state ?? "—"} Senate${cls}`;
  }
  return `${e.district_code ?? e.state ?? "—"}`;
}

function seatSubhead(e: DashboardElection): string {
  if (e.leadership_role) {
    const chamber = e.office === "house" ? "House" : "Senate";
    return e.restricted_party
      ? `${chamber} · ${e.restricted_party} caucus`
      : `${chamber} chamber-wide`;
  }
  if (e.office === "president") return "Nationwide race";
  if (e.office === "senate") return "Statewide race";
  return "House district";
}

function searchBlob(e: DashboardElection): string {
  return [
    e.office,
    e.phase,
    e.district_code ?? "",
    e.state ?? "",
    e.senate_class ? `class ${e.senate_class}` : "",
    e.leadership_role ?? "",
    e.leadership_role ? leadershipRoleLabel(e.leadership_role as LeadershipRole) : "",
    e.restricted_party ?? "",
    OFFICE_LABEL[officeBucket(e)] ?? e.office,
  ]
    .join(" ")
    .toLowerCase();
}

function isMyRace(
  e: DashboardElection,
  userDistrict: string | null,
  userState: string | null,
): boolean {
  // Leadership races: everyone in the matching chamber-ish area sees them in "your ballot".
  // We don't have role info here, so fall back to matching the chamber's geographic area.
  if (e.leadership_role) return true;
  if (e.office === "president") return true;
  if (e.office === "house" && userDistrict) {
    return e.district_code?.toUpperCase() === userDistrict.toUpperCase();
  }
  if (e.office === "senate" && userState) {
    return (e.state ?? "").toUpperCase() === userState.toUpperCase();
  }
  return false;
}

/**
 * Main race card. Uniform size, whole surface is a link.
 * Variant "hero" adds accent border for the "Your ballot" row.
 */
function RaceCard({
  e,
  hero = false,
}: {
  e: DashboardElection;
  hero?: boolean;
}) {
  const tone = phaseStyle(e.phase);
  const cd = countdown(e);

  const borderBase = hero
    ? "border-2 border-[var(--psc-accent)]/50"
    : "border border-[var(--psc-border)]";

  return (
    <Link
      href={`/elections/${e.id}`}
      className={`group relative flex h-full min-w-0 flex-col overflow-hidden rounded-lg bg-[var(--psc-panel)] shadow-sm transition hover:shadow-md ${borderBase} ${tone.cardAccent}`}
    >
      {/* colored phase spine */}
      <span className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} />

      <div className="flex flex-col gap-3 p-4 pl-5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone.pill}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
            {tone.badgeLabel}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            {OFFICE_LABEL[officeBucket(e)] ?? e.office}
          </span>
          {hero ? (
            <span className="ml-auto rounded bg-[var(--psc-ink)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
              Yours
            </span>
          ) : null}
        </div>

        <div className="space-y-0.5">
          <p className="truncate text-lg font-semibold leading-tight text-[var(--psc-ink)]">
            {seatHeadline(e)}
          </p>
          <p className="text-xs text-[var(--psc-muted)]">{seatSubhead(e)}</p>
        </div>

        <div className="mt-auto flex items-end justify-between gap-2 pt-2 text-xs">
          <div className="flex items-center gap-1.5 text-[var(--psc-muted)]">
            <span className="font-semibold text-[var(--psc-ink)]">
              {e.candidate_count}
            </span>
            {e.candidate_count === 1 ? "candidate" : "candidates"}
          </div>
          {cd ? (
            <div
              className={`font-mono text-[11px] ${cd.urgent ? "font-semibold text-red-700" : "text-[var(--psc-muted)]"}`}
            >
              {cd.text}
            </div>
          ) : null}
        </div>
      </div>
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
            active
              ? "bg-white/20 text-white"
              : "bg-[var(--psc-canvas)] text-[var(--psc-muted)]"
          }`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function ChamberSection({
  office,
  races,
}: {
  office: Office;
  races: DashboardElection[];
}) {
  if (!races.length) return null;

  const sorted = [...races].sort((a, b) => {
    if (office === "leadership") {
      const ak = a.leadership_role ?? "";
      const bk = b.leadership_role ?? "";
      if (ak !== bk) return ak.localeCompare(bk);
      return (a.restricted_party ?? "").localeCompare(b.restricted_party ?? "");
    }
    const ac = a.district_code ?? a.state ?? "";
    const bc = b.district_code ?? b.state ?? "";
    return ac.localeCompare(bc);
  });

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--psc-border)] pb-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
          {OFFICE_LABEL[office]}
        </h2>
        <span className="font-mono text-xs text-[var(--psc-muted)]">
          {races.length} {races.length === 1 ? "race" : "races"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sorted.map((r) => (
          <RaceCard key={r.id} e={r} />
        ))}
      </div>
    </section>
  );
}

export function ElectionsDashboard({
  elections,
  userDistrict,
  userState,
  rpDateLabel = null,
}: Props) {
  const [query, setQuery] = useState("");
  const [phaseFilter, setPhaseFilter] = useState<Phase | "all">("all");
  const [officeFilter, setOfficeFilter] = useState<Office | "all">("all");

  const myRaces = useMemo(
    () => elections.filter((e) => isMyRace(e, userDistrict, userState)),
    [elections, userDistrict, userState],
  );

  const phaseCounts: Record<Phase, number> = { filing: 0, primary: 0, general: 0 };
  const officeCounts: Record<Office, number> = {
    house: 0,
    senate: 0,
    president: 0,
    leadership: 0,
  };
  for (const e of elections) {
    if ((PHASES as readonly string[]).includes(e.phase)) {
      phaseCounts[e.phase as Phase]++;
    }
    const bucket = officeBucket(e);
    if ((OFFICES as readonly string[]).includes(bucket)) {
      officeCounts[bucket]++;
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return elections.filter((e) => {
      if (phaseFilter !== "all" && e.phase !== phaseFilter) return false;
      if (officeFilter !== "all" && officeBucket(e) !== officeFilter) return false;
      if (q && !searchBlob(e).includes(q)) return false;
      return true;
    });
  }, [elections, query, phaseFilter, officeFilter]);

  const grouped = useMemo(() => {
    const byOffice = new Map<Office, DashboardElection[]>();
    for (const e of filtered) {
      const key = officeBucket(e);
      if (!OFFICES.includes(key)) continue;
      const list = byOffice.get(key) ?? [];
      list.push(e);
      byOffice.set(key, list);
    }
    return byOffice;
  }, [filtered]);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Elections</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--psc-muted)]">
            {elections.length} active race{elections.length === 1 ? "" : "s"} across House,
            Senate, and President.
          </p>
        </div>
        {rpDateLabel ? <RpDatePill label={rpDateLabel} /> : null}
      </header>

      {/* Your ballot: hero cards */}
      {myRaces.length ? (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
              Your ballot
            </h2>
            <span className="text-[10px] text-[var(--psc-muted)]">
              {userDistrict ? `District ${userDistrict}` : ""}
              {userDistrict && userState ? " · " : ""}
              {userState ? `State ${userState}` : ""}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {myRaces.map((e) => (
              <RaceCard key={e.id} e={e} hero />
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-4 text-xs text-[var(--psc-muted)]">
          Set your{" "}
          <Link
            href="/character"
            className="font-semibold text-[var(--psc-accent)] underline"
          >
            Character
          </Link>{" "}
          home district and residence state to pin your own races at the top.
        </section>
      )}

      {/* Filters */}
      <section className="space-y-3 rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Search state or district (e.g. CA-12)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 rounded border border-[var(--psc-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--psc-accent)] sm:min-w-[20rem] sm:flex-initial"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded border border-[var(--psc-border)] bg-white px-2 py-1 text-xs text-[var(--psc-muted)] hover:border-[var(--psc-accent)]"
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
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
        </div>
      </section>

      {/* Race grid, grouped by chamber */}
      {!filtered.length ? (
        <section className="rounded-lg border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-10 text-center text-sm text-[var(--psc-muted)]">
          No races match your filters.
        </section>
      ) : (
        <div className="space-y-8">
          {OFFICES.map((office) => (
            <ChamberSection
              key={office}
              office={office}
              races={grouped.get(office) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
