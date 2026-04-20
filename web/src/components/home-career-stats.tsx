import Link from "next/link";
import type { HomeCareerStats } from "@/lib/home-career-stats";

function usd(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function HomeCareerStats({ stats }: { stats: HomeCareerStats }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] shadow-sm">
      <div className="border-b border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-ink)_4%,transparent)] px-5 py-4">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Your Washington receipt</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--psc-muted)]">
          Money, office, races, and bills—numbers you can brag about or use as fuel.
        </p>
      </div>

      <div className="grid gap-px bg-[var(--psc-border)] sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-[var(--psc-panel)] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
            Office
          </p>
          <p className="mt-2 text-lg font-semibold text-[var(--psc-ink)]">{stats.primaryTitle}</p>
        </div>

        <div className="bg-[var(--psc-panel)] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
            Economy
          </p>
          {stats.economyAvailable ? (
            <>
              <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-[var(--psc-ink)]">
                {usd(stats.walletBalance)}
              </p>
              <Link
                href="/economy"
                className="mt-3 inline-block text-xs font-semibold text-[var(--psc-accent)] underline underline-offset-2"
              >
                Open economy
              </Link>
            </>
          ) : (
            <p className="mt-2 text-sm text-[var(--psc-muted)]">
              Wallet data is not available on this deployment yet.
            </p>
          )}
        </div>

        <div className="bg-[var(--psc-panel)] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
            Elections
          </p>
          <p className="mt-2 text-lg font-semibold tabular-nums text-[var(--psc-ink)]">
            {stats.electionsWon} wins · {stats.electionsLost} losses
          </p>
          <Link
            href="/elections"
            className="mt-3 inline-block text-xs font-semibold text-[var(--psc-accent)] underline underline-offset-2"
          >
            Elections hub
          </Link>
        </div>

        <div className="bg-[var(--psc-panel)] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
            Bills you authored
          </p>
          <p className="mt-2 text-lg font-semibold tabular-nums text-emerald-900">
            {stats.billsSignedIntoLaw} signed into law
          </p>
          <p className="mt-2 text-xs text-[var(--psc-muted)]">
            <span className="font-mono text-[var(--psc-ink)]">{stats.billsAuthored}</span> proposed ·{" "}
            <span className="font-mono text-[var(--psc-ink)]">{stats.billsDeadOrVetoed}</span> dead or
            vetoed
          </p>
          <Link
            href="/congress"
            className="mt-3 inline-block text-xs font-semibold text-[var(--psc-accent)] underline underline-offset-2"
          >
            Congress
          </Link>
        </div>
      </div>
    </section>
  );
}
