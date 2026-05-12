"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type CongressChamberBadgeCounts = {
  hopper: number;
};

function CountBubble({
  count,
  title,
}: {
  count: number;
  title: string;
}) {
  if (count < 1) return null;
  const label = count > 99 ? "99+" : String(count);
  return (
    <span
      title={title}
      aria-label={`${title}: ${label}`}
      className="inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white"
    >
      {label}
    </span>
  );
}

function segmentClass(active: boolean) {
  return [
    "min-w-[5.25rem] flex flex-1 justify-center rounded-md px-3 py-2 text-sm font-semibold transition-colors",
    active
      ? "bg-[var(--psc-panel)] text-[var(--psc-ink)] shadow-sm"
      : "text-[var(--psc-muted)] hover:text-[var(--psc-ink)]",
  ].join(" ");
}

export function CongressChamberNav({
  showHopper,
  chamberBadges,
}: {
  showHopper: boolean;
  chamberBadges?: CongressChamberBadgeCounts | null;
}) {
  const pathname = usePathname();
  const onLeadership = pathname.startsWith("/congress/leadership");
  const onOverview = pathname === "/congress" && !onLeadership;
  const onHouse = pathname === "/congress/house" || pathname.startsWith("/congress/house/");
  const onSenate = pathname === "/congress/senate" || pathname.startsWith("/congress/senate/");
  const b: CongressChamberBadgeCounts = chamberBadges ?? { hopper: 0 };

  return (
    <div className="border-b border-[var(--psc-border)] bg-[var(--psc-panel)]">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div
          className="inline-flex flex-1 min-w-[min(100%,18rem)] rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-1 shadow-[inset_0_1px_2px_rgba(15,23,42,0.05)] sm:flex-initial"
          role="tablist"
          aria-label="Congress sections"
        >
          <Link href="/congress" className={segmentClass(onOverview)} role="tab" aria-selected={onOverview}>
            Overview
          </Link>
          <Link href="/congress/house" className={segmentClass(onHouse)} role="tab" aria-selected={onHouse}>
            House
          </Link>
          <Link href="/congress/senate" className={segmentClass(onSenate)} role="tab" aria-selected={onSenate}>
            Senate
          </Link>
        </div>
        {showHopper ? (
          <Link
            href="/congress/leadership"
            className={`ml-auto inline-flex items-center gap-1.5 text-sm font-semibold transition-colors ${
              onLeadership
                ? "text-[var(--psc-ink)] underline decoration-[var(--psc-border)] underline-offset-4"
                : "text-[var(--psc-muted)] hover:text-[var(--psc-ink)]"
            }`}
          >
            <span>Hopper</span>
            <CountBubble
              count={b.hopper}
              title="Filings, docket moves, scheduling, and bills in debate (pre–floor vote)"
            />
          </Link>
        ) : null}
      </div>
    </div>
  );
}
