"use client";

import { useMemo, useState } from "react";

type RoleRow = {
  role_key: string;
  role_label: string;
  holders: string[];
};

type Group = {
  id: string;
  label: string;
  rows: RoleRow[];
};

export function HierarchyTabs({ groups }: { groups: Group[] }) {
  const [active, setActive] = useState(groups[0]?.id ?? "");
  const current = useMemo(() => groups.find((g) => g.id === active) ?? groups[0], [active, groups]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setActive(g.id)}
            className={
              g.id === current?.id
                ? "rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white"
                : "rounded border border-[var(--psc-border)] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)]"
            }
          >
            {g.label}
          </button>
        ))}
      </div>

      <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          {current?.label}
        </h2>
        {!current?.rows.length ? (
          <p className="mt-3 text-sm text-[var(--psc-muted)]">No positions configured.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {current.rows.map((r) => (
              <li
                key={r.role_key}
                className="flex flex-wrap items-start justify-between gap-2 border border-[var(--psc-border)] bg-white px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-semibold text-[var(--psc-ink)]">{r.role_label}</p>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">{r.role_key}</p>
                </div>
                <div className="text-right text-sm">
                  {r.holders.length ? (
                    r.holders.map((h) => (
                      <p key={`${r.role_key}-${h}`} className="font-medium text-[var(--psc-ink)]">
                        {h}
                      </p>
                    ))
                  ) : (
                    <p className="text-[var(--psc-muted)]">Vacant</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}