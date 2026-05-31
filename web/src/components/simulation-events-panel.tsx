"use client";

import { useState, useTransition } from "react";
import { respondToSimulationEvent } from "@/app/actions/simulation-events";
import {
  SIMULATION_EVENT_CHOICES,
  type SimulationEventChoice,
  type UserSimulationEvent,
} from "@/lib/simulation-events";

const btn =
  "rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-white hover:brightness-110 disabled:opacity-50";

function deadlineLabel(iso: string) {
  const d = new Date(iso);
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return "Past due";
  const h = Math.floor(ms / 3_600_000);
  if (h < 48) return `${h}h left`;
  const days = Math.floor(h / 24);
  return `${days}d left`;
}

export function SimulationEventsPanel({ events }: { events: UserSimulationEvent[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  if (!events.length) {
    return (
      <p className="text-sm text-[var(--psc-muted)]">
        No active events assigned to you. New crises spawn on the daily simulation tick when the calendar is
        running.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {msg ? (
        <p className="rounded border border-emerald-800/30 bg-emerald-950/10 px-3 py-2 text-xs text-emerald-950">
          {msg}
        </p>
      ) : null}
      {events.map((ev) => (
        <article
          key={ev.id}
          className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--psc-muted)]">
                {ev.assignment.role_label}
                {ev.assignment.is_primary ? " · lead" : ""}
              </p>
              <h3 className="text-sm font-semibold text-[var(--psc-ink)]">{ev.title}</h3>
            </div>
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-950">
              {deadlineLabel(ev.deadline_at)}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--psc-muted)]">{ev.summary}</p>
          <p className="mt-1 text-[10px] text-[var(--psc-muted)]">
            Severity {ev.severity}/5 · miss the deadline → approval hit
            {ev.assignment.is_primary ? " (larger if you are lead)" : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {SIMULATION_EVENT_CHOICES.map((c) => (
              <button
                key={c.key}
                type="button"
                disabled={pending}
                className={btn}
                title={c.hint}
                onClick={() => {
                  setMsg(null);
                  start(async () => {
                    try {
                      await respondToSimulationEvent(ev.id, c.key as SimulationEventChoice);
                      setMsg("Response recorded.");
                    } catch (e) {
                      setMsg(e instanceof Error ? e.message : String(e));
                    }
                  });
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
