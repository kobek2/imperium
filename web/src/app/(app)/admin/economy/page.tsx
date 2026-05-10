import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminWalletAdjustForm } from "@/components/admin-wallet-adjust-form";
import { EconomyPublicLedgerList } from "@/components/economy-public-ledger-list";
import { fetchEconomyLedgerWithDisplayNames } from "@/lib/economy-ledger-view";
import { getServerAuth } from "@/lib/supabase/server";
import { requireStaffPage } from "@/lib/staff-access";

export default async function AdminEconomyPage() {
  await requireStaffPage("economy");

  const { supabase } = await getServerAuth();
  if (!supabase) redirect("/");

  const ledgerRows = await fetchEconomyLedgerWithDisplayNames(supabase, 200);

  return (
    <div className="mx-auto max-w-5xl space-y-8 text-sm text-[var(--psc-muted)]">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--psc-border)] pb-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Staff</p>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Economy</h1>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed">
            Same public ledger as the player economy portal, plus wallet adjustments. Balance changes require the new{" "}
            <code className="font-mono text-[11px]">economy_staff_adjust_wallet</code> RPC (run the latest Supabase
            migration).
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <Link href="/economy" className="text-[var(--psc-accent)] underline underline-offset-2">
            Player economy
          </Link>
          <Link href="/admin/economy/overview" className="text-[var(--psc-accent)] underline underline-offset-2">
            Fiscal overview
          </Link>
        </div>
      </header>

      <AdminWalletAdjustForm />

      <EconomyPublicLedgerList
        rows={ledgerRows}
        title="Activity log (global)"
        subtitle="Latest 200 lines across all wallets"
      />
    </div>
  );
}
