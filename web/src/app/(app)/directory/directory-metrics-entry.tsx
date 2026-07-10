"use client";

import { NavRouteButton } from "@/components/nav-route-button";

export function DirectoryMetricsEntry() {
  return (
    <section className="mb-10 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">City</p>
      <h2 className="mt-1 text-lg font-semibold text-[var(--psc-ink)]">City indicators</h2>
      <p className="mt-2 max-w-2xl text-sm text-[var(--psc-muted)]">
        Stocks, personal finances, and the mayor&apos;s city budget live on their own pages.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <NavRouteButton href="/economy">Open economy</NavRouteButton>
        <NavRouteButton href="/mayor">Mayor&apos;s office</NavRouteButton>
        <NavRouteButton href="/council">City Council</NavRouteButton>
      </div>
    </section>
  );
}
