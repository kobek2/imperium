"use client";

import { NavRouteButton } from "@/components/nav-route-button";

export function DirectoryMetricsEntry({ showFederalBudget }: { showFederalBudget: boolean }) {
  return (
    <section className="mb-10 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Nation</p>
      <h2 className="mt-1 text-lg font-semibold text-[var(--psc-ink)]">National figures</h2>
      <p className="mt-2 max-w-2xl text-sm text-[var(--psc-muted)]">
        National metrics and public federal tax brackets live on their own page. The federal appropriations workspace is only
        for the President and admins. Use{" "}
        <span className="font-semibold text-[var(--psc-ink)]">Home</span>
        {" "}or the all-parties hub if you need the other party&apos;s room.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <NavRouteButton href="/national-metrics">Open national metrics</NavRouteButton>
        {showFederalBudget ? <NavRouteButton href="/economy/federal">Federal budget</NavRouteButton> : null}
      </div>
    </section>
  );
}
