"use client";

import { useMemo, useState } from "react";
import { DeleteWireArticleButton } from "@/components/delete-wire-article-button";
import { WireArticleBody } from "@/components/wire-article-body";
import {
  formatWireCopyBlock,
  groupWireIntoArcs,
  wireBeatLabel,
  wireDeadlineLabel,
  wireScopeLabel,
  wireStatusLabel,
  wireTopicLabel,
  type NewsStoryArc,
  type WireFeedItem,
} from "@/lib/simulation-events";

function severityBar(severity: number): string {
  const filled = "█".repeat(Math.min(5, Math.max(1, severity)));
  const empty = "░".repeat(5 - filled.length);
  return filled + empty;
}

function ArticleCard({
  item,
  arcTotal,
  isLatest,
  onCopy,
  copiedId,
  compact = false,
  canAdminDelete = false,
}: {
  item: WireFeedItem;
  arcTotal: number;
  isLatest: boolean;
  onCopy: (item: WireFeedItem, arcBeat: number, arcTotal: number) => void;
  copiedId: string | null;
  compact?: boolean;
  canAdminDelete?: boolean;
}) {
  const isLive = item.status === "active";
  const showFull = isLatest || !compact;
  return (
    <article
      id={`evt-${item.id}`}
      className={`relative scroll-mt-28 border-l-4 py-3 pl-4 ${canAdminDelete ? "pr-11" : ""} ${
        isLive ? "border-red-600 bg-red-50/40" : "border-[var(--psc-border)] bg-transparent"
      }`}
    >
      {canAdminDelete ? (
        <div className="absolute right-0 top-0">
          <DeleteWireArticleButton instanceId={item.id} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {isLive && isLatest ? (
          <span className="animate-pulse rounded bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            Live
          </span>
        ) : null}
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--psc-muted)]">
          {wireBeatLabel(item.beat_label)}
          {arcTotal > 1 ? ` · ${item.beat_number ?? 1}/${arcTotal}` : ""}
        </span>
        <span className="rounded bg-[var(--psc-canvas)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--psc-muted)]">
          {wireTopicLabel(item.topic)}
        </span>
        {isLive ? (
          <span className="text-[10px] font-semibold text-red-700">{wireDeadlineLabel(item.deadline_at)}</span>
        ) : (
          <span className="text-[10px] font-semibold text-[var(--psc-muted)]">{wireStatusLabel(item.status)}</span>
        )}
      </div>
      <h3 className={`mt-1.5 font-semibold leading-snug ${isLive && isLatest ? "text-lg text-red-950" : "text-base text-[var(--psc-ink)]"}`}>
        {item.title}
      </h3>
      <div className="mt-2">
        <WireArticleBody
          summary={item.summary}
          dateline={item.dateline}
          body={showFull ? item.body : null}
          publishedAt={item.opened_at}
          compact={!showFull}
        />
      </div>
      {item.outcome && item.status !== "active" ? (
        <p className="mt-2 text-xs text-[var(--psc-ink)]">
          <span className="font-semibold">Latest:</span> {item.outcome}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px] text-red-800/80" title="Severity">
          {severityBar(item.severity)}
        </span>
        <button
          type="button"
          className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-accent)] underline-offset-2 hover:underline"
          onClick={() => onCopy(item, item.beat_number ?? 1, arcTotal)}
        >
          {copiedId === item.id ? "Copied" : "Copy for Discord"}
        </button>
      </div>
    </article>
  );
}

function StoryArcBlock({
  arc,
  copiedId,
  onCopy,
  canAdminDelete,
}: {
  arc: NewsStoryArc;
  copiedId: string | null;
  onCopy: (item: WireFeedItem, arcBeat: number, arcTotal: number) => void;
  canAdminDelete?: boolean;
}) {
  const [expanded, setExpanded] = useState(arc.isActive);
  const total = arc.beats.length;
  const priorBeats = arc.beats.slice(0, -1);
  const latest = arc.latest;

  return (
    <section
      className={`overflow-hidden rounded-lg border shadow-sm ${
        arc.isActive ? "border-red-300/80 bg-white ring-1 ring-red-100" : "border-[var(--psc-border)] bg-[var(--psc-panel)]"
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--psc-border)] bg-[var(--psc-canvas)] px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--psc-muted)]">
            {wireScopeLabel(latest.category)}
          </span>
          {arc.isActive ? (
            <span className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
              Developing story
            </span>
          ) : null}
          {total > 1 ? (
            <span className="text-[10px] text-[var(--psc-muted)]">{total} updates</span>
          ) : null}
        </div>
        {priorBeats.length > 0 ? (
          <button
            type="button"
            className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-accent)]"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide earlier" : "Show timeline"}
          </button>
        ) : null}
      </header>
      <div className="px-4 pb-3 pt-2">
        {expanded && priorBeats.length > 0 ? (
          <div className="mb-3 space-y-1 border-b border-dashed border-[var(--psc-border)] pb-3 opacity-80">
            {priorBeats.map((beat) => (
              <ArticleCard
                key={beat.id}
                item={beat}
                arcTotal={total}
                isLatest={false}
                copiedId={copiedId}
                onCopy={onCopy}
                compact
                canAdminDelete={canAdminDelete}
              />
            ))}
          </div>
        ) : null}
        <ArticleCard
          item={latest}
          arcTotal={total}
          isLatest
          copiedId={copiedId}
          onCopy={onCopy}
          canAdminDelete={canAdminDelete}
        />
      </div>
    </section>
  );
}

export function NewsroomTicker({ arcs }: { arcs: NewsStoryArc[] }) {
  const live = arcs.filter((a) => a.isActive).slice(0, 4);
  if (!live.length) return null;

  return (
    <div className="overflow-hidden rounded-md border border-red-700/40 bg-red-950 text-white">
      <div className="flex items-stretch">
        <div className="flex shrink-0 items-center bg-red-600 px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest">
          Breaking
        </div>
        <ul className="min-w-0 flex-1 divide-y divide-red-900/50">
          {live.map((a) => (
            <li key={a.arcId} className="truncate px-4 py-2 text-xs font-medium">
              <span className="text-red-300">{wireTopicLabel(a.latest.topic)} · </span>
              {a.latest.title}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function NewsroomFeed({
  items,
  canAdminDelete = false,
}: {
  items: WireFeedItem[];
  canAdminDelete?: boolean;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "domestic" | "international" | "live">("all");

  const arcs = useMemo(() => groupWireIntoArcs(items), [items]);

  const filtered = useMemo(() => {
    if (filter === "all") return arcs;
    if (filter === "live") return arcs.filter((a) => a.isActive);
    return arcs.filter((a) => a.latest.category === filter);
  }, [arcs, filter]);

  const handleCopy = async (item: WireFeedItem, arcBeat: number, arcTotal: number) => {
    const text = formatWireCopyBlock(item, {
      siteUrl: typeof window !== "undefined" ? window.location.origin : undefined,
      arcBeat,
      arcTotal,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId((id) => (id === item.id ? null : id)), 2000);
    } catch {
      setCopiedId(null);
    }
  };

  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--psc-border)] bg-[var(--psc-panel)] p-8 text-center">
        <p className="text-sm font-semibold text-[var(--psc-ink)]">The newsroom is quiet</p>
        <p className="mt-2 text-xs text-[var(--psc-muted)]">
          Breaking stories spawn daily on the wire. When you are assigned to a crisis, response tools appear above.
        </p>
      </div>
    );
  }

  const tabs: Array<{ key: typeof filter; label: string }> = [
    { key: "all", label: "All" },
    { key: "live", label: "Live" },
    { key: "domestic", label: "United States" },
    { key: "international", label: "World" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter(t.key)}
            className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${
              filter === t.key
                ? "bg-red-600 text-white"
                : "border border-[var(--psc-border)] bg-[var(--psc-panel)] text-[var(--psc-muted)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="space-y-4">
        {filtered.map((arc) => (
          <StoryArcBlock
            key={arc.arcId}
            arc={arc}
            copiedId={copiedId}
            onCopy={handleCopy}
            canAdminDelete={canAdminDelete}
          />
        ))}
      </div>
      {!filtered.length ? (
        <p className="text-sm text-[var(--psc-muted)]">No stories match this filter.</p>
      ) : null}
    </div>
  );
}
