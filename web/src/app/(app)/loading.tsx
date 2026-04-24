export default function AppLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10" aria-busy="true" aria-label="Loading">
      <div className="h-9 w-48 animate-pulse rounded-md bg-[var(--psc-border)]/60" />
      <div className="space-y-3">
        <div className="h-4 w-full animate-pulse rounded bg-[var(--psc-border)]/40" />
        <div className="h-4 w-5/6 max-w-xl animate-pulse rounded bg-[var(--psc-border)]/40" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-[var(--psc-border)]/40" />
      </div>
      <div className="h-40 animate-pulse rounded-lg border border-[var(--psc-border)]/50 bg-[var(--psc-panel)]/40" />
    </div>
  );
}
