import Link from "next/link";
import {
  STAFF_GRANT_KEYS,
  STAFF_PERMISSION_LABELS,
  STAFF_PERMISSION_ORDER,
  type StaffPermission,
} from "@/lib/staff-permissions";
import { requireStaffPanelPage, type StaffAccess } from "@/lib/staff-access";

function canSeeArea(access: StaffAccess, anyOf: readonly StaffPermission[]): boolean {
  if (access.hasFullStaff) return true;
  return anyOf.some((p) => access.permissions.has(p));
}

const AREAS: {
  title: string;
  blurb: string;
  href: string;
  anyOf: StaffPermission[];
  grantHint: string;
}[] = [
  {
    title: "Accounts & directory",
    blurb: "Profile search, Discord IDs, districts, and grant readouts. Use for moderation and account lookups.",
    href: "/admin/members",
    anyOf: ["accounts", "roles"],
    grantHint: "staff_accounts or staff_roles",
  },
  {
    title: "Economy & balances",
    blurb: "Central place for economic administration (wallets, party treasuries). Narrow grants can view this route; RPCs may still require full staff for writes.",
    href: "/admin/economy",
    anyOf: ["economy"],
    grantHint: "staff_economy",
  },
  {
    title: "Elections & races",
    blurb: "FEC console: create races, phases, bulk end, dormant filing, RP calendar card.",
    href: "/admin/elections",
    anyOf: ["elections", "simulation"],
    grantHint: "staff_elections or staff_simulation",
  },
  {
    title: "Party leadership",
    blurb: "Manual starts for party officer elections and related workflows.",
    href: "/admin/party-leadership",
    anyOf: ["parties"],
    grantHint: "staff_parties",
  },
];

export default async function AdminOperationsPage() {
  const access = await requireStaffPanelPage();

  return (
    <div className="space-y-8 text-sm">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
          Operations
        </p>
        <h2 className="text-xl font-semibold text-[var(--psc-ink)]">Staff & permissions</h2>
        <p className="mt-2 max-w-3xl text-[var(--psc-muted)]">
          Granular access uses{" "}
          <code className="font-mono text-xs">government_role_grants.role_key</code>.{" "}
          <strong className="text-[var(--psc-ink)]">admin</strong> or{" "}
          <strong className="text-[var(--psc-ink)]">{STAFF_GRANT_KEYS.super}</strong> has full access
          (including database policies). Narrower <code className="font-mono text-xs">staff_*</code> keys
          unlock routes below; some server actions still require full staff until split per permission.
        </p>
      </div>

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          Your access
        </h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {access.hasFullStaff ? (
            <li className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-950">
              Full staff (admin or {STAFF_GRANT_KEYS.super})
            </li>
          ) : (
            STAFF_PERMISSION_ORDER.filter((p) => access.permissions.has(p)).map((p) => (
              <li
                key={p}
                className="rounded-full bg-[var(--psc-canvas)] px-2.5 py-1 text-xs font-medium text-[var(--psc-ink)]"
              >
                {STAFF_PERMISSION_LABELS[p]}
              </li>
            ))
          )}
          {!access.hasFullStaff && access.permissions.size === 0 ? (
            <li className="text-xs text-amber-900">
              You have panel access but no granular keys — ask for specific <code className="font-mono">staff_*</code>{" "}
              grants.
            </li>
          ) : null}
        </ul>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {AREAS.map((a) => {
          const ok = canSeeArea(access, a.anyOf);
          return (
            <div
              key={a.title}
              className={`flex flex-col rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 ${
                ok ? "" : "opacity-60"
              }`}
            >
              <h3 className="font-semibold text-[var(--psc-ink)]">{a.title}</h3>
              <p className="mt-1 flex-1 text-xs text-[var(--psc-muted)]">{a.blurb}</p>
              {ok ? (
                <Link
                  href={a.href}
                  className="mt-3 inline-flex text-xs font-semibold text-[var(--psc-accent)] underline underline-offset-2"
                >
                  Open
                </Link>
              ) : (
                <p className="mt-3 text-[11px] text-amber-900">
                  Requires <code className="font-mono">{a.grantHint}</code>
                </p>
              )}
            </div>
          );
        })}
      </section>

      <section className="max-w-2xl rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 text-xs text-[var(--psc-muted)]">
        <h3 className="font-semibold text-[var(--psc-ink)]">Server activity dashboard</h3>
        <p className="mt-1">
          Cross-cutting metrics and charts (economy ledger, bills, elections, party treasuries, PACs, campaigns,
          national stats). Available to anyone who can open this panel.
        </p>
        <Link
          href="/admin/activity"
          className="mt-3 inline-flex text-xs font-semibold text-[var(--psc-accent)] underline underline-offset-2"
        >
          Open activity overview
        </Link>
      </section>

      <section className="max-w-2xl rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-4 text-xs text-[var(--psc-muted)]">
        <p className="font-semibold text-[var(--psc-ink)]">Grant keys (reference)</p>
        <ul className="mt-2 list-inside list-disc space-y-1 font-mono text-[11px]">
          <li>admin — legacy full operator</li>
          <li>{STAFF_GRANT_KEYS.super} — full operator (same RLS as admin)</li>
          <li>
            staff_accounts, staff_roles, staff_economy, staff_elections, staff_parties, staff_simulation — route-level
          </li>
        </ul>
      </section>
    </div>
  );
}
