import Link from "next/link";
import { requireStaffPage } from "@/lib/staff-access";

export default async function AdminEconomyPage() {
  await requireStaffPage("economy");

  return (
    <div className="max-w-2xl space-y-4 text-sm text-[var(--psc-muted)]">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
          Economy
        </p>
        <h2 className="text-xl font-semibold text-[var(--psc-ink)]">Economic administration</h2>
        <p className="mt-2">
          This page is the home for staff tools that adjust wallets, treasuries, and payouts. Player-facing
          flows stay on <strong className="text-[var(--psc-ink)]">Economy</strong> in the main nav.
        </p>
      </div>
      <section className="rounded border border-amber-800/40 bg-amber-50 p-4 text-amber-950">
        <p className="text-xs font-semibold uppercase tracking-wide">Database access</p>
        <p className="mt-2 text-xs leading-relaxed">
          Many balance mutations still go through Supabase policies that require{" "}
          <code className="font-mono">admin</code> or <code className="font-mono">staff_super</code>. If you
          have only <code className="font-mono">staff_economy</code>, you can open this route; wire new RPCs
          here that check <code className="font-mono">staff_economy</code> explicitly for fine-grained control.
        </p>
      </section>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/economy"
          className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white"
        >
          Open player economy
        </Link>
        <Link
          href="/economy/leaderboard"
          className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)]"
        >
          Leaderboard
        </Link>
        <Link
          href="/admin/operations"
          className="text-xs font-semibold text-[var(--psc-accent)] underline underline-offset-2"
        >
          Back to operations
        </Link>
      </div>
    </div>
  );
}
