import Link from "next/link";

export default function AdminHomePage() {
  return (
    <div className="max-w-2xl space-y-6 text-sm text-[var(--psc-muted)]">
      <p>
        Create races, move phases, and finalize results without opening the Supabase SQL editor. The
        election form only asks for fields that apply to the office you pick (House, Senate, or
        President).
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/admin/elections"
          className="admin-cardlink border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-3 font-semibold text-[var(--psc-ink)] hover:border-[var(--psc-accent)] active:brightness-[0.97]"
        >
          Elections
          <span className="mt-1 block text-xs font-normal text-[var(--psc-muted)]">List races, create seats, run phases.</span>
        </Link>
        <Link
          href="/directory"
          className="admin-cardlink border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-3 font-semibold text-[var(--psc-ink)] hover:border-[var(--psc-accent)] active:brightness-[0.97]"
        >
          Government directory
          <span className="mt-1 block text-xs font-normal text-[var(--psc-muted)]">
            Who holds which role (opens the main directory).
          </span>
        </Link>
      </div>
    </div>
  );
}
