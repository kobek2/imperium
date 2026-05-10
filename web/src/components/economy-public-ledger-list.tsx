import type { EconomyLedgerDisplayRow } from "@/lib/economy-ledger-view";

function formatSignedMoney(amount: number): string {
  const abs = Math.abs(amount);
  const core = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(abs);
  if (amount > 0) return `+${core}`;
  if (amount < 0) return `−${core.replace(/^-/, "")}`;
  return core;
}

export function EconomyPublicLedgerList({
  rows,
  title = "Recent public ledger",
  subtitle = "Showing latest public transactions",
}: {
  rows: EconomyLedgerDisplayRow[];
  title?: string;
  subtitle?: string;
}) {
  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">{title}</h2>
        <p className="text-xs text-[var(--psc-muted)]">{subtitle}</p>
      </div>
      <ul className="mt-4 max-h-[28rem] space-y-2 overflow-y-auto font-mono text-[11px] text-[var(--psc-muted)]">
        {rows.length === 0 ? (
          <li className="text-sm text-[var(--psc-muted)]">No ledger rows yet.</li>
        ) : (
          rows.map((row) => (
            <li
              key={row.id}
              className="grid gap-1 border-b border-[var(--psc-border)]/60 py-2 md:grid-cols-[150px_minmax(0,1fr)_150px_120px] md:items-center"
            >
              <span>{new Date(row.created_at).toLocaleString()}</span>
              <span className="min-w-0">
                <span className="font-semibold text-[var(--psc-ink)]">{row.walletName}</span>
                {row.relatedName ? <span className="ml-2 text-[var(--psc-muted)]">with {row.relatedName}</span> : null}
              </span>
              <span className="text-[var(--psc-ink)]">{row.kind}</span>
              <span className={`md:text-right ${row.delta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {formatSignedMoney(Number(row.delta))}
              </span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
