import type { ReactNode } from "react";
import Link from "next/link";
import {
  ADMIN_ACTIVITY_BILL_STATUS_SAMPLE,
  type AdminServerActivitySnapshot,
  type LedgerDaySlice,
  type LedgerKindSlice,
} from "@/lib/admin-server-activity";

function fmtUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
  }).format(n);
}

function fmtPct(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Number(n).toFixed(1)}%`;
}

function partyCommitteeLabel(key: string) {
  if (key === "democrat") return "Democratic National Committee";
  if (key === "republican") return "Republican National Committee";
  return key;
}

function shortId(id: string) {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function DailyLedgerBars({ series }: { series: LedgerDaySlice[] }) {
  const maxC = Math.max(1, ...series.map((s) => s.count));
  return (
    <div className="space-y-2">
      <div className="flex h-36 items-end gap-px rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-1 pt-2 pb-1">
        {series.map((s) => (
          <div
            key={s.day}
            title={`${s.day}: ${s.count} ledger lines, net ${fmtUsd(s.netDelta)}`}
            className="min-w-[2px] flex-1 rounded-t bg-[color-mix(in_srgb,var(--psc-accent)_85%,transparent)] transition-opacity hover:opacity-100"
            style={{ height: `${Math.max(4, (s.count / maxC) * 100)}%`, opacity: s.count ? 0.95 : 0.12 }}
          />
        ))}
      </div>
      <p className="text-[10px] text-[var(--psc-muted)]">
        Each bar is one calendar day (UTC). Height scales to the busiest day in the window.
      </p>
    </div>
  );
}

function LedgerKindBars({ kinds }: { kinds: LedgerKindSlice[] }) {
  const top = kinds.slice(0, 14);
  const maxC = Math.max(1, ...top.map((k) => k.count));
  return (
    <ul className="space-y-2">
      {top.map((k) => (
        <li key={k.kind} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
          <div className="min-w-0">
            <div className="flex h-2 overflow-hidden rounded-full bg-[var(--psc-canvas)]">
              <div
                className="rounded-full bg-[var(--psc-accent)]"
                style={{ width: `${(k.count / maxC) * 100}%` }}
              />
            </div>
          </div>
          <span className="shrink-0 tabular-nums text-[var(--psc-muted)]">{k.count}</span>
          <span className="col-span-2 truncate font-mono text-[11px] text-[var(--psc-ink)]">{k.kind}</span>
        </li>
      ))}
    </ul>
  );
}

function StatusHistogram({
  label,
  rows,
}: {
  label: string;
  rows: Record<string, number>;
}) {
  const entries = Object.entries(rows).sort((a, b) => b[1] - a[1]);
  const maxV = Math.max(1, ...entries.map(([, v]) => v));
  if (!entries.length) {
    return <p className="text-xs text-[var(--psc-muted)]">No {label} rows returned.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {entries.map(([key, v]) => (
        <li key={key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs">
          <div className="flex h-2 min-w-0 overflow-hidden rounded-full bg-[var(--psc-canvas)]">
            <div
              className="rounded-full bg-emerald-700/80"
              style={{ width: `${(v / maxV) * 100}%` }}
            />
          </div>
          <span className="shrink-0 tabular-nums text-[var(--psc-muted)]">{v}</span>
          <span className="col-span-2 truncate font-mono text-[11px] text-[var(--psc-ink)]">{key}</span>
        </li>
      ))}
    </ul>
  );
}

function PacKindBars({ byKind }: { byKind: { standard: number; dark: number } }) {
  const rows = [
    { key: "Disclosed PACs", n: byKind.standard },
    { key: "Dark-money PACs", n: byKind.dark },
  ];
  const maxN = Math.max(1, ...rows.map((x) => x.n));
  return (
    <div className="space-y-2">
      {rows.map(({ key, n }) => (
        <div key={key} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 text-[var(--psc-muted)]">{key}</span>
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--psc-canvas)]">
            <div className="h-full rounded-full bg-violet-700/75" style={{ width: `${(n / maxN) * 100}%` }} />
          </div>
          <span className="w-8 shrink-0 text-right tabular-nums text-[var(--psc-muted)]">{n}</span>
        </div>
      ))}
    </div>
  );
}

function MetricCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">{title}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--psc-ink)]">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-[var(--psc-muted)]">{hint}</p> : null}
    </div>
  );
}

export function ServerActivityDashboard({ snapshot }: { snapshot: AdminServerActivitySnapshot }) {
  const openElections =
    (snapshot.electionsByPhase.filing ?? 0) +
    (snapshot.electionsByPhase.primary ?? 0) +
    (snapshot.electionsByPhase.general ?? 0);

  const billsInPipeline = Object.entries(snapshot.billsByStatus).reduce((acc, [st, n]) => {
    if (st === "law" || st === "dead" || st === "vetoed" || st === "failed") return acc;
    return acc + n;
  }, 0);

  return (
    <div className="max-w-6xl space-y-10 text-sm text-[var(--psc-muted)]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
            Staff · Intelligence
          </p>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Server activity overview</h1>
          <p className="mt-2 max-w-3xl">
            Cross-cutting readout of player economy, legislation, elections, party committees, PACs, and campaign
            mechanics. Figures are point-in-time from the database; ledger charts use the most recent{" "}
            {snapshot.ledgerSampleTruncated ? "sample cap (see note below)" : "30-day"} window.
          </p>
          <p className="mt-1 text-[11px]">
            Generated <span className="font-mono text-[var(--psc-ink)]">{snapshot.generatedAt}</span> (UTC).
          </p>
        </div>
        <Link href="/admin" className="text-xs font-semibold text-[var(--psc-accent)] underline underline-offset-2">
          ← Admin home
        </Link>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard title="Profiles (directory universe)" value={snapshot.profileCount ?? "—"} />
        <MetricCard
          title="Sum of player wallet balances"
          value={fmtUsd(snapshot.walletBalanceSum)}
          hint={`${snapshot.walletRows ?? "—"} wallet rows loaded`}
        />
        <MetricCard title="Open elections (non-closed)" value={openElections} hint="By phase in histogram below" />
        <MetricCard title="Bill records (total)" value={snapshot.totalBills ?? "—"} />
        <MetricCard title="Bills in active pipeline" value={billsInPipeline} hint="Excludes law, dead, vetoed, failed" />
        <MetricCard title="FEC filings (candidates)" value={snapshot.electionCandidatesTotal ?? "—"} />
        <MetricCard title="Primary votes (14d)" value={snapshot.primaryVotes14d ?? "—"} />
        <MetricCard title="General votes (14d)" value={snapshot.generalVotes14d ?? "—"} />
        <MetricCard title="Campaign endorsements (14d)" value={snapshot.endorsements14d ?? "—"} />
        <MetricCard title="Campaign ads placed (30d)" value={snapshot.campaignAds30d ?? "—"} />
        <MetricCard title="Bill votes cast (7d)" value={snapshot.billVotes7d ?? "—"} />
        <MetricCard title="Party officer candidacies" value={snapshot.officerCandidaciesTotal ?? "—"} />
      </section>

      {(snapshot.ledgerSampleTruncated || snapshot.billsStatusSampleTruncated) && (
        <div className="rounded border border-amber-800/40 bg-amber-50 px-4 py-3 text-xs text-amber-950">
          {snapshot.ledgerSampleTruncated ? (
            <p>
              Ledger chart uses up to 15,000 most recent lines in the last 30 days; older lines in that window may be
              omitted if volume is very high.
            </p>
          ) : null}
          {snapshot.billsStatusSampleTruncated ? (
            <p className={snapshot.ledgerSampleTruncated ? "mt-1" : ""}>
              Bill status histogram sampled the first{" "}
              {ADMIN_ACTIVITY_BILL_STATUS_SAMPLE.toLocaleString()} bill rows by default ordering — totals
              may be incomplete if you have more bills than that.
            </p>
          ) : null}
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Economy pulse</h2>
          <p className="mt-1 text-xs">Ledger traffic by day (last 30 days, UTC).</p>
          <div className="mt-4">
            <DailyLedgerBars series={snapshot.ledgerDaily30} />
          </div>
        </div>
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Ledger mix (14d)</h2>
          <p className="mt-1 text-xs">Top kinds by line count among lines in the chart sample that fall in the last 14 days.</p>
          <div className="mt-4 max-h-64 overflow-y-auto pr-1">
            <LedgerKindBars kinds={snapshot.ledgerKinds14} />
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Elections by phase</h2>
          <p className="mt-1 text-xs">All race rows (up to 2,000 loaded for aggregation).</p>
          <div className="mt-4">
            <StatusHistogram label="election" rows={snapshot.electionsByPhase} />
          </div>
        </div>
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Bills by status</h2>
          <p className="mt-1 text-xs">Histogram of bill pipeline positions.</p>
          <div className="mt-4 max-h-72 overflow-y-auto pr-1">
            <StatusHistogram label="bill" rows={snapshot.billsByStatus} />
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Party committees &amp; PACs</h2>
          <p className="mt-1 text-xs">
            National party treasuries (in-world committees) plus registered PAC tiers across players.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[320px] text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--psc-border)] text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
                  <th className="py-2 pr-2">Committee</th>
                  <th className="py-2 pr-2">Treasury</th>
                  <th className="py-2">Charter</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.partyOrgs.map((po) => (
                  <tr key={po.party_key} className="border-b border-[var(--psc-border)]/60">
                    <td className="py-2 pr-2 font-medium text-[var(--psc-ink)]">{partyCommitteeLabel(po.party_key)}</td>
                    <td className="py-2 pr-2 tabular-nums text-[var(--psc-ink)]">{fmtUsd(Number(po.treasury_balance))}</td>
                    <td className="py-2 text-[var(--psc-muted)]">
                      {po.charter_ratified_at
                        ? new Date(po.charter_ratified_at).toLocaleDateString()
                        : "Not ratified"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Registered PACs</h3>
            <p className="mt-1 text-[11px]">Players with a PAC row: {snapshot.pacTotal ?? "—"}.</p>
            <div className="mt-3 max-w-sm">
              <PacKindBars byKind={snapshot.pacByKind} />
            </div>
          </div>
        </div>

        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Nation &amp; budget</h2>
          <p className="mt-1 text-xs">Active fiscal year snapshot when configured.</p>
          {snapshot.fiscalYear ? (
            <dl className="mt-4 space-y-2 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--psc-muted)]">Fiscal year</dt>
                <dd className="font-medium text-[var(--psc-ink)]">{snapshot.fiscalYear.label}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--psc-muted)]">FY status</dt>
                <dd className="font-mono text-[var(--psc-ink)]">{snapshot.fiscalYear.status}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--psc-muted)]">Federal budget</dt>
                <dd className="font-mono text-[var(--psc-ink)]">{snapshot.budgetStatus ?? "—"}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-4 text-xs">No active <code className="font-mono">rp_fiscal_years</code> row.</p>
          )}
          {snapshot.nationalMetrics ? (
            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              <li className="rounded bg-[var(--psc-canvas)] px-3 py-2">
                <p className="text-[10px] uppercase text-[var(--psc-muted)]">Gov. approval</p>
                <p className="text-lg font-semibold text-[var(--psc-ink)]">
                  {fmtPct(snapshot.nationalMetrics.government_approval)}
                </p>
              </li>
              <li className="rounded bg-[var(--psc-canvas)] px-3 py-2">
                <p className="text-[10px] uppercase text-[var(--psc-muted)]">Unemployment</p>
                <p className="text-lg font-semibold text-[var(--psc-ink)]">
                  {fmtPct(snapshot.nationalMetrics.unemployment_rate)}
                </p>
              </li>
              <li className="rounded bg-[var(--psc-canvas)] px-3 py-2">
                <p className="text-[10px] uppercase text-[var(--psc-muted)]">Poverty rate</p>
                <p className="text-lg font-semibold text-[var(--psc-ink)]">
                  {fmtPct(snapshot.nationalMetrics.poverty_percentage)}
                </p>
              </li>
              <li className="rounded bg-[var(--psc-canvas)] px-3 py-2">
                <p className="text-[10px] uppercase text-[var(--psc-muted)]">Crime index</p>
                <p className="text-lg font-semibold text-[var(--psc-ink)]">
                  {snapshot.nationalMetrics.crime_total != null
                    ? Number(snapshot.nationalMetrics.crime_total).toLocaleString()
                    : "—"}
                </p>
              </li>
              <li className="rounded bg-[var(--psc-canvas)] px-3 py-2 sm:col-span-2">
                <p className="text-[10px] uppercase text-[var(--psc-muted)]">Public debt (sim)</p>
                <p className="text-lg font-semibold text-[var(--psc-ink)]">
                  {snapshot.nationalMetrics.us_debt != null
                    ? fmtUsd(Number(snapshot.nationalMetrics.us_debt))
                    : "—"}
                </p>
              </li>
            </ul>
          ) : snapshot.fiscalYear ? (
            <p className="mt-4 text-xs">No national metrics row for the active FY yet.</p>
          ) : null}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 lg:col-span-1">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Recent ledger</h2>
          <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto text-[11px]">
            {snapshot.recentLedger.map((r) => (
              <li key={r.id} className="rounded border border-[var(--psc-border)]/70 bg-[var(--psc-canvas)] px-2 py-1.5">
                <div className="flex justify-between gap-2">
                  <span className="font-mono text-[var(--psc-ink)]">{r.kind}</span>
                  <span className={Number(r.delta) < 0 ? "text-red-800" : "text-emerald-900"}>
                    {fmtUsd(Number(r.delta))}
                  </span>
                </div>
                <div className="mt-0.5 flex justify-between text-[var(--psc-muted)]">
                  <span className="font-mono">{shortId(r.wallet_user_id)}</span>
                  <span>{new Date(r.created_at).toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 lg:col-span-1">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Recent bills</h2>
          <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto text-[11px]">
            {snapshot.recentBills.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/bill/${b.id}`}
                  className="block rounded border border-[var(--psc-border)]/70 bg-[var(--psc-canvas)] px-2 py-1.5 transition-colors hover:border-[var(--psc-accent)]"
                >
                  <span className="line-clamp-2 font-medium text-[var(--psc-ink)]">{b.title}</span>
                  <div className="mt-1 flex justify-between gap-2 text-[var(--psc-muted)]">
                    <span className="font-mono">{b.status}</span>
                    <span>{new Date(b.created_at).toLocaleDateString()}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 lg:col-span-1">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Recent campaign ads</h2>
          <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto text-[11px]">
            {snapshot.recentAds.map((a) => (
              <li key={a.id} className="rounded border border-[var(--psc-border)]/70 bg-[var(--psc-canvas)] px-2 py-1.5">
                <div className="flex justify-between gap-2 text-[var(--psc-ink)]">
                  <span>
                    +{Number(a.points)} pts
                    {a.target_state ? ` · ${a.target_state}` : ""}
                  </span>
                  <Link className="shrink-0 font-semibold text-[var(--psc-accent)] underline" href={`/elections/${a.election_id}`}>
                    Race
                  </Link>
                </div>
                <p className="mt-0.5 font-mono text-[var(--psc-muted)]">{shortId(a.id)}</p>
                <p className="text-[var(--psc-muted)]">{new Date(a.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
