/** Compact RP simulation date badge for page headers. */
export function RpDatePill({ label }: { label: string }) {
  return (
    <div
      className="inline-flex items-baseline gap-2 rounded-md border border-[var(--psc-border)] bg-[var(--psc-panel)]/95 px-3 py-2 shadow-sm"
      title="Simulation calendar date"
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Date</span>
      <span className="font-mono text-sm font-semibold tabular-nums tracking-tight text-[var(--psc-ink)]">
        {label}
      </span>
    </div>
  );
}
