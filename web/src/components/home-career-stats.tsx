import { NavRouteButton } from "@/components/nav-route-button";
import type { HomeCareerStats } from "@/lib/home-career-stats";

function usd(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function HomeCareerStats({ stats }: { stats: HomeCareerStats }) {
  const lawHighlight = stats.billsSignedIntoLaw > 0;

  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-amber-200/80 bg-gradient-to-b from-amber-50/90 via-[var(--psc-panel)] to-[var(--psc-panel)] shadow-[0_12px_40px_-12px_rgba(146,64,14,0.35)]">
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-amber-300/25 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-[var(--psc-accent)]/10 blur-3xl"
        aria-hidden
      />

      <header className="relative border-b border-amber-200/60 bg-gradient-to-r from-amber-100/50 via-white/40 to-transparent px-6 py-5 md:px-8 md:py-6">
        <div className="flex flex-wrap items-start gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-amber-400/70 bg-gradient-to-br from-amber-100 to-amber-200/80 text-2xl shadow-inner"
            aria-hidden
          >
            ★
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-amber-900/70">Career recognition</p>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-[var(--psc-ink)] md:text-2xl">Your city hall receipt</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--psc-muted)]">
              A compact award slip for what you have earned in the sim—office, purse, political capital, races, and bills
              shipped into law.
            </p>
          </div>
        </div>
      </header>

      <div className="relative grid gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3 xl:grid-cols-5 xl:gap-4">
        <div className="rounded-xl border border-indigo-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm ring-1 ring-indigo-100">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Political capital</p>
          <p className="mt-3 font-mono text-3xl font-bold tabular-nums tracking-tight text-indigo-950">
            {stats.politicalCapital.toLocaleString()}
          </p>
          <p className="mt-2 text-xs text-[var(--psc-muted)]">
            Earned from election wins, leadership races, and bills signed into law.
          </p>
        </div>

        <div className="rounded-xl border border-[var(--psc-border)] bg-white/90 p-5 shadow-sm backdrop-blur-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Office held</p>
          <p className="mt-3 text-lg font-bold leading-snug text-[var(--psc-ink)]">{stats.primaryTitle}</p>
          <p className="mt-2 text-xs text-[var(--psc-muted)]">Highest government title merged from grants.</p>
        </div>

        <div className="rounded-xl border border-[var(--psc-border)] bg-white/90 p-5 shadow-sm backdrop-blur-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Economy</p>
          {stats.economyAvailable ? (
            <>
              <p className="mt-3 font-mono text-2xl font-bold tabular-nums tracking-tight text-emerald-900">
                {usd(stats.walletBalance)}
              </p>
              <p className="mt-1 text-xs font-medium text-emerald-800/80">Wallet balance</p>
              <div className="mt-4">
                <NavRouteButton href="/economy" className="px-2 py-1.5 text-xs">
                  Open economy
                </NavRouteButton>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-[var(--psc-muted)]">Wallet data is not available on this deployment yet.</p>
          )}
        </div>

        <div className="rounded-xl border border-[var(--psc-border)] bg-white/90 p-5 shadow-sm backdrop-blur-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Elections</p>
          <p className="mt-3 text-2xl font-bold tabular-nums text-[var(--psc-ink)]">
            <span className="text-emerald-700">{stats.electionsWon}</span>
            <span className="mx-1 text-lg font-semibold text-[var(--psc-muted)]">/</span>
            <span className="text-rose-700">{stats.electionsLost}</span>
          </p>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">Wins vs losses (closed races)</p>
          <div className="mt-4">
            <NavRouteButton href="/elections" className="px-2 py-1.5 text-xs">
              Elections hub
            </NavRouteButton>
          </div>
        </div>

        <div
          className={`rounded-xl border bg-white/90 p-5 shadow-sm backdrop-blur-sm ${
            lawHighlight
              ? "border-amber-400/90 ring-2 ring-amber-300/50 ring-offset-2 ring-offset-amber-50/50"
              : "border-[var(--psc-border)]"
          }`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Legislation</p>
          <p
            className={`mt-3 text-2xl font-bold tabular-nums ${lawHighlight ? "text-amber-950" : "text-[var(--psc-ink)]"}`}
          >
            {stats.billsSignedIntoLaw}{" "}
            <span className="text-base font-semibold text-[var(--psc-muted)]">signed into law</span>
          </p>
          {lawHighlight ? (
            <p className="mt-2 text-xs font-semibold text-amber-900">That is the hard part—nice work.</p>
          ) : (
            <p className="mt-2 text-xs text-[var(--psc-muted)]">Your first law is a milestone worth chasing.</p>
          )}
          <p className="mt-2 text-xs text-[var(--psc-muted)]">
            <span className="font-mono font-semibold text-[var(--psc-ink)]">{stats.billsAuthored}</span> filed ·{" "}
            <span className="font-mono font-semibold text-[var(--psc-ink)]">{stats.billsDeadOrVetoed}</span> dead or
            vetoed
          </p>
          <div className="mt-4">
            <NavRouteButton href="/mayor" className="px-2 py-1.5 text-xs">
              Mayor&apos;s Office
            </NavRouteButton>
          </div>
        </div>
      </div>
    </section>
  );
}
