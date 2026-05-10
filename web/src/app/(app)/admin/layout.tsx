import Link from "next/link";
import { getStaffAccess } from "@/lib/staff-access";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await getStaffAccess();
  if (!access?.canAccessPanel) {
    return (
      <div className="mx-auto max-w-lg px-6 py-20 text-center">
        <h1 className="text-xl font-semibold text-[var(--psc-ink)]">Access restricted</h1>
        <p className="mt-3 text-sm text-[var(--psc-muted)]">
          Staff tools require one of: <code className="font-mono">admin</code> or{" "}
          <code className="font-mono">staff_super</code> in{" "}
          <code className="font-mono">government_role_grants</code> (or legacy{" "}
          <code className="font-mono">profiles.office_role = admin</code>), or a granular{" "}
          <code className="font-mono">staff_*</code> grant (e.g. <code className="font-mono">staff_elections</code>
          ).
        </p>
        <Link
          href="/"
          className="admin-textlink mt-6 inline-block text-sm font-semibold text-[var(--psc-accent)] underline underline-offset-2"
        >
          Return to home
        </Link>
      </div>
    );
  }

  return (
    <div className="admin-shell space-y-8">
      <div className="border-b border-[var(--psc-border)] pb-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">
          Administration
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <h1 className="text-2xl font-semibold">FEC operations</h1>
          <nav className="admin-shell-nav flex flex-wrap gap-1 text-sm font-medium">
            <Link
              href="/admin"
              className="rounded-md px-2.5 py-1.5 text-[var(--psc-accent)] underline-offset-2 transition-colors hover:bg-[color-mix(in_srgb,var(--psc-border)_45%,transparent)] hover:underline active:bg-[color-mix(in_srgb,var(--psc-border)_70%,transparent)] active:brightness-95"
            >
              Overview
            </Link>
            <Link
              href="/admin/operations"
              className="rounded-md px-2.5 py-1.5 text-[var(--psc-accent)] underline-offset-2 transition-colors hover:bg-[color-mix(in_srgb,var(--psc-border)_45%,transparent)] hover:underline active:bg-[color-mix(in_srgb,var(--psc-border)_70%,transparent)] active:brightness-95"
            >
              Operations
            </Link>
            <Link
              href="/admin/activity"
              className="rounded-md px-2.5 py-1.5 text-[var(--psc-accent)] underline-offset-2 transition-colors hover:bg-[color-mix(in_srgb,var(--psc-border)_45%,transparent)] hover:underline active:bg-[color-mix(in_srgb,var(--psc-border)_70%,transparent)] active:brightness-95"
            >
              Activity
            </Link>
            <Link
              href="/admin/elections"
              className="rounded-md px-2.5 py-1.5 text-[var(--psc-accent)] underline-offset-2 transition-colors hover:bg-[color-mix(in_srgb,var(--psc-border)_45%,transparent)] hover:underline active:bg-[color-mix(in_srgb,var(--psc-border)_70%,transparent)] active:brightness-95"
            >
              Elections
            </Link>
            <Link
              href="/admin/leadership"
              className="rounded-md px-2.5 py-1.5 text-[var(--psc-accent)] underline-offset-2 transition-colors hover:bg-[color-mix(in_srgb,var(--psc-border)_45%,transparent)] hover:underline active:bg-[color-mix(in_srgb,var(--psc-border)_70%,transparent)] active:brightness-95"
            >
              Leadership
            </Link>
            <Link
              href="/admin/members"
              className="rounded-md px-2.5 py-1.5 text-[var(--psc-accent)] underline-offset-2 transition-colors hover:bg-[color-mix(in_srgb,var(--psc-border)_45%,transparent)] hover:underline active:bg-[color-mix(in_srgb,var(--psc-border)_70%,transparent)] active:brightness-95"
            >
              Members
            </Link>
            <Link
              href="/admin/economy"
              className="rounded-md px-2.5 py-1.5 text-[var(--psc-accent)] underline-offset-2 transition-colors hover:bg-[color-mix(in_srgb,var(--psc-border)_45%,transparent)] hover:underline active:bg-[color-mix(in_srgb,var(--psc-border)_70%,transparent)] active:brightness-95"
            >
              Economy
            </Link>
            <Link
              href="/admin/party-leadership"
              className="rounded-md px-2.5 py-1.5 text-[var(--psc-accent)] underline-offset-2 transition-colors hover:bg-[color-mix(in_srgb,var(--psc-border)_45%,transparent)] hover:underline active:bg-[color-mix(in_srgb,var(--psc-border)_70%,transparent)] active:brightness-95"
            >
              Party leadership
            </Link>
            <Link
              href="/"
              className="rounded-md px-2.5 py-1.5 text-[var(--psc-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--psc-border)_35%,transparent)] hover:text-[var(--psc-ink)] active:bg-[color-mix(in_srgb,var(--psc-border)_60%,transparent)] active:text-[var(--psc-ink)]"
            >
              Exit admin
            </Link>
          </nav>
        </div>
      </div>
      {children}
    </div>
  );
}
