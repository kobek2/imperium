"use client";

import { useState, useTransition } from "react";
import {
  formatWireCopyBlock,
  wireCategoryLabel,
  wireDeadlineLabel,
  wireStatusLabel,
  type WireFeedItem,
} from "@/lib/simulation-events";

function statusTone(status: WireFeedItem["status"]): string {
  if (status === "active") return "bg-amber-100 text-amber-950";
  if (status === "resolved") return "bg-emerald-100 text-emerald-950";
  if (status === "escalated") return "bg-orange-100 text-orange-950";
  return "bg-rose-100 text-rose-950";
}

export function WireFeedPanel({ items }: { items: WireFeedItem[] }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!items.length) {
    return (
      <p className="text-sm text-[var(--psc-muted)]">
        No wire stories yet. Staff can publish from Admin → Elections, or stories spawn when the simulation
        calendar advances.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <article
          key={item.id}
          id={`evt-${item.id}`}
          className="scroll-mt-24 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--psc-muted)]">
                Imperium Wire · {wireCategoryLabel(item.category)}
              </p>
              <h3 className="text-sm font-semibold text-[var(--psc-ink)]">{item.title}</h3>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${statusTone(item.status)}`}>
                {wireStatusLabel(item.status)}
              </span>
              {item.status === "active" ? (
                <span className="rounded bg-[var(--psc-canvas)] px-2 py-0.5 text-[10px] font-semibold text-[var(--psc-muted)]">
                  {wireDeadlineLabel(item.deadline_at)}
                </span>
              ) : null}
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--psc-muted)]">{item.summary}</p>
          {item.outcome && item.status !== "active" ? (
            <p className="mt-2 text-xs text-[var(--psc-ink)]">
              <span className="font-semibold">Outcome:</span> {item.outcome}
            </p>
          ) : null}
          <p className="mt-1 text-[10px] text-[var(--psc-muted)]">Severity {item.severity}/5</p>
          <button
            type="button"
            className="mt-3 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-ink)] hover:bg-white"
            onClick={async () => {
              const text = formatWireCopyBlock(item, {
                siteUrl: typeof window !== "undefined" ? window.location.origin : undefined,
              });
              try {
                await navigator.clipboard.writeText(text);
                setCopiedId(item.id);
                window.setTimeout(() => setCopiedId((id) => (id === item.id ? null : id)), 2000);
              } catch {
                setCopiedId(null);
              }
            }}
          >
            {copiedId === item.id ? "Copied for Discord" : "Copy for Discord"}
          </button>
        </article>
      ))}
    </div>
  );
}
