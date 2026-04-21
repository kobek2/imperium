import Link from "next/link";
import { requireStaffPanelPage } from "@/lib/staff-access";

export default async function AdminHomePage() {
  await requireStaffPanelPage();

  return (
    <div className="max-w-2xl space-y-6 text-sm text-[var(--psc-muted)]">
      <p>
        Staff tools for elections, members, parties, and simulation. Access is split by{" "}
        <code className="font-mono text-xs">staff_*</code> grants; full operators use{" "}
        <code className="font-mono text-xs">admin</code> or <code className="font-mono text-xs">staff_super</code>.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/admin/operations"
          className="admin-cardlink border border-[var(--psc-accent)] bg-[var(--psc-panel)] px-4 py-3 font-semibold text-[var(--psc-ink)] hover:border-[var(--psc-accent)] active:brightness-[0.97]"
        >
          Operations & permissions
          <span className="mt-1 block text-xs font-normal text-[var(--psc-muted)]">
            Overview of accounts, roles, economy, grants, and what you can open.
          </span>
        </Link>
        <Link
          href="/admin/elections"
          className="admin-cardlink border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-3 font-semibold text-[var(--psc-ink)] hover:border-[var(--psc-accent)] active:brightness-[0.97]"
        >
          Elections
          <span className="mt-1 block text-xs font-normal text-[var(--psc-muted)]">
            List races, create seats, run phases, RP calendar.
          </span>
        </Link>
        <Link
          href="/admin/members"
          className="admin-cardlink border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-3 font-semibold text-[var(--psc-ink)] hover:border-[var(--psc-accent)] active:brightness-[0.97]"
        >
          Member database
          <span className="mt-1 block text-xs font-normal text-[var(--psc-muted)]">
            Profiles, Discord IDs, seats, and role grants.
          </span>
        </Link>
        <Link
          href="/admin/economy"
          className="admin-cardlink border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-3 font-semibold text-[var(--psc-ink)] hover:border-[var(--psc-accent)] active:brightness-[0.97]"
        >
          Economy administration
          <span className="mt-1 block text-xs font-normal text-[var(--psc-muted)]">
            Staff hub for wallets and treasuries (narrow grants + future RPCs).
          </span>
        </Link>
        <Link
          href="/directory"
          className="admin-cardlink border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-3 font-semibold text-[var(--psc-ink)] hover:border-[var(--psc-accent)] active:brightness-[0.97]"
        >
          Government directory
          <span className="mt-1 block text-xs font-normal text-[var(--psc-muted)]">
            Public org chart (opens the main directory).
          </span>
        </Link>
        <Link
          href="/admin/party-leadership"
          className="admin-cardlink border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-3 font-semibold text-[var(--psc-ink)] hover:border-[var(--psc-accent)] active:brightness-[0.97]"
        >
          Party leadership
          <span className="mt-1 block text-xs font-normal text-[var(--psc-muted)]">
            Open a 24h D/R election for chair, vice chair, and treasurer.
          </span>
        </Link>
      </div>
    </div>
  );
}
