"use client";

import { useFormStatus } from "react-dom";
import { useMemo, useState } from "react";
import { openSelectedSeatElectionFilings } from "@/app/actions/simulation";
import type { DormantOpenCandidate } from "@/lib/admin-dormant-open-candidates";

function OpenSubmit({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || count < 1}
      className="rounded border border-amber-900 bg-amber-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Opening…" : `Open filing for selected (${count})`}
    </button>
  );
}

export function OpenDormantSeatFilingsSelector({ candidates }: { candidates: DormantOpenCandidate[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const byOffice = useMemo(() => {
    const house = candidates.filter((c) => c.office === "house");
    const senate = candidates.filter((c) => c.office === "senate");
    const president = candidates.filter((c) => c.office === "president");
    return { house, senate, president };
  }, [candidates]);

  function toggle(id: string, next: boolean) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (next) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  function selectGroup(ids: string[]) {
    setSelected((prev) => {
      const n = new Set(prev);
      for (const id of ids) n.add(id);
      return n;
    });
  }

  function clearGroup(ids: string[]) {
    setSelected((prev) => {
      const n = new Set(prev);
      for (const id of ids) n.delete(id);
      return n;
    });
  }

  if (!candidates.length) {
    return (
      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Open dormant seat filings</h3>
        <p className="mt-1 text-xs text-[var(--psc-muted)]">
          No dormant House, Senate, or President races right now with at least one player in the
          jurisdiction. Create dormant races from <span className="font-semibold">New race</span> (optional
          “dormant filing”), or wait for templates to exist.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm">
      <div>
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Open dormant seat filings</h3>
        <p className="mt-1 max-w-3xl text-xs text-[var(--psc-muted)]">
          Only races where someone already lives in the district (House) or state (Senate), or any player exists
          (President). Pick one or many — each opens a fresh filing → primary → general schedule from the
          moment you confirm (same as opening from a single race page).
        </p>
      </div>

      <form
        action={openSelectedSeatElectionFilings}
        className="space-y-4 border-t border-[var(--psc-border)] pt-3"
      >
        {[...selected].map((id) => (
          <input key={id} type="hidden" name="election_id" value={id} />
        ))}

        <div className="flex flex-wrap items-center gap-2">
          <OpenSubmit count={selected.size} />
          <button
            type="button"
            onClick={() => selectGroup(candidates.map((c) => c.electionId))}
            className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--psc-ink)] hover:border-[var(--psc-accent)]"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--psc-muted)] hover:border-[var(--psc-accent)]"
          >
            Clear
          </button>
        </div>

        {renderGroup(
          "House (by district)",
          byOffice.house,
          selected,
          toggle,
          (ids) => selectGroup(ids),
          (ids) => clearGroup(ids),
        )}
        {renderGroup(
          "Senate (by state)",
          byOffice.senate,
          selected,
          toggle,
          (ids) => selectGroup(ids),
          (ids) => clearGroup(ids),
        )}
        {renderGroup(
          "President",
          byOffice.president,
          selected,
          toggle,
          (ids) => selectGroup(ids),
          (ids) => clearGroup(ids),
        )}
      </form>
    </section>
  );
}

function renderGroup(
  title: string,
  rows: DormantOpenCandidate[],
  selected: Set<string>,
  toggle: (id: string, next: boolean) => void,
  selectGroup: (ids: string[]) => void,
  clearGroup: (ids: string[]) => void,
) {
  if (!rows.length) return null;
  const ids = rows.map((r) => r.electionId);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
          {title}
        </span>
        <button
          type="button"
          onClick={() => selectGroup(ids)}
          className="text-[11px] font-semibold text-[var(--psc-accent)] hover:underline"
        >
          This group
        </button>
        <button
          type="button"
          onClick={() => clearGroup(ids)}
          className="text-[11px] text-[var(--psc-muted)] hover:underline"
        >
          Clear group
        </button>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((c) => (
          <li key={c.electionId}>
            <label className="flex cursor-pointer items-center gap-2 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/80 px-2 py-1.5 text-xs hover:border-[var(--psc-accent)]">
              <input
                type="checkbox"
                checked={selected.has(c.electionId)}
                onChange={(e) => toggle(c.electionId, e.target.checked)}
                className="h-3.5 w-3.5 shrink-0"
              />
              <span className="min-w-0 flex-1 font-mono text-[11px] font-semibold text-[var(--psc-ink)]">
                {c.label}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--psc-muted)]">
                {c.playerCount}p
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
