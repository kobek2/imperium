"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function segmentClass(active: boolean) {
  return [
    "min-w-[5.25rem] flex flex-1 justify-center rounded-md px-3 py-2 text-sm font-semibold transition-colors",
    active
      ? "bg-[var(--psc-panel)] text-[var(--psc-ink)] shadow-sm"
      : "text-[var(--psc-muted)] hover:text-[var(--psc-ink)]",
  ].join(" ");
}

export function CongressChamberNav({ showHopper }: { showHopper: boolean }) {
  const pathname = usePathname();
  const onLeadership = pathname.startsWith("/congress/leadership");
  const onOverview = pathname === "/congress" && !onLeadership;
  const onHouse = pathname === "/congress/house" || pathname.startsWith("/congress/house/");
  const onSenate = pathname === "/congress/senate" || pathname.startsWith("/congress/senate/");

  return (
    <div className="border-b border-[var(--psc-border)] bg-[var(--psc-panel)]">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div
          className="inline-flex flex-1 min-w-[min(100%,18rem)] rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-1 shadow-[inset_0_1px_2px_rgba(15,23,42,0.05)] sm:flex-initial"
          role="tablist"
          aria-label="Congress sections"
        >
          <Link
            href="/congress"
            className={segmentClass(onOverview)}
            role="tab"
            aria-selected={onOverview}
          >
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
            className={`ml-auto text-sm font-semibold transition-colors ${
              onLeadership
                ? "text-[var(--psc-ink)] underline decoration-[var(--psc-border)] underline-offset-4"
                : "text-[var(--psc-muted)] hover:text-[var(--psc-ink)]"
            }`}
          >
            Hopper
          </Link>
        ) : null}
      </div>
    </div>
  );
}
