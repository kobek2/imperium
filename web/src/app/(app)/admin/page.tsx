import Link from "next/link";
import { STAFF_GRANT_KEYS } from "@/lib/staff-permissions";
import type { StaffPermission } from "@/lib/staff-permissions";
import { requireStaffPanelPage, type StaffAccess } from "@/lib/staff-access";

function canOpenRoute(
  access: StaffAccess,
  anyOf: readonly StaffPermission[] | null,
): boolean {
  if (anyOf === null || anyOf.length === 0) return true;
  if (access.hasFullStaff) return true;
  return anyOf.some((p) => access.permissions.has(p));
}

const GRANT_LABEL: Record<StaffPermission, string> = {
  accounts: STAFF_GRANT_KEYS.accounts,
  roles: STAFF_GRANT_KEYS.roles,
  economy: STAFF_GRANT_KEYS.economy,
  elections: STAFF_GRANT_KEYS.elections,
  parties: STAFF_GRANT_KEYS.parties,
  simulation: STAFF_GRANT_KEYS.simulation,
};

type OverviewCardDef = {
  href: string;
  category: string;
  title: string;
  body: string;
  anyOf: readonly StaffPermission[] | null;
  accessNote?: "public";
};

const OVERVIEW_CARDS: OverviewCardDef[] = [
  {
    href: "/admin/members",
    category: "People",
    title: "Member lookup",
    body: "Profiles, Discord IDs, regions, districts, and role grants.",
    anyOf: ["accounts", "roles"],
  },
  {
    href: "/admin/elections",
    category: "Elections",
    title: "Elections console",
    body: "Manual race lifecycle and congress appointments.",
    anyOf: ["elections", "simulation"],
  },
  {
    href: "/admin/leadership-elections",
    category: "Elections",
    title: "Leadership elections",
    body: "Open Congress and party leadership elections from one admin module.",
    anyOf: ["elections", "simulation", "parties"],
  },
  {
    href: "/directory",
    category: "Site",
    title: "Government directory",
    body: "Public org chart (same page players use).",
    anyOf: null,
    accessNote: "public",
  },
];

const cardBtnClass =
  "mt-4 inline-flex w-full items-center justify-center rounded-md border-2 border-[var(--psc-accent)] bg-[color-mix(in_srgb,var(--psc-accent)_12%,white)] px-3 py-2 text-center text-sm font-bold text-[var(--psc-ink)] no-underline transition hover:bg-[color-mix(in_srgb,var(--psc-accent)_20%,white)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--psc-accent)]";

function GrantChips({
  anyOf,
  accessNote,
}: {
  anyOf: readonly StaffPermission[] | null;
  accessNote?: "public";
}) {
  if (accessNote === "public") {
    return (
      <span className="inline-flex rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--psc-muted)]">
        public
      </span>
    );
  }
  if (anyOf === null) {
    return (
      <span className="inline-flex rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--psc-muted)]">
        panel
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {anyOf.map((p) => (
        <span
          key={p}
          className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--psc-ink)]"
        >
          {GRANT_LABEL[p]}
        </span>
      ))}
    </span>
  );
}

function ToolCard({
  card,
  access,
}: {
  card: OverviewCardDef;
  access: StaffAccess;
}) {
  const ok = canOpenRoute(access, card.anyOf);
  const chips = <GrantChips anyOf={card.anyOf} accessNote={card.accessNote} />;

  const body = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--psc-muted)]">
        {card.category}
      </p>
      <h2 className="mt-1 text-base font-semibold text-[var(--psc-ink)]">{card.title}</h2>
      <div className="mt-2">{chips}</div>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--psc-muted)]">{card.body}</p>
      {ok ? (
        <span className={cardBtnClass}>Open →</span>
      ) : (
        <p className="mt-4 rounded border border-dashed border-amber-800/35 bg-amber-50/90 px-3 py-2 text-center text-[11px] font-semibold text-amber-950">
          Needs grant above or full staff
        </p>
      )}
    </>
  );

  if (!ok) {
    return (
      <div className="flex flex-col rounded-lg border border-dashed border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-panel)_92%,var(--psc-canvas))] p-5 opacity-[0.88]">
        {body}
      </div>
    );
  }

  return (
    <Link
      href={card.href}
      className="admin-cardlink group flex flex-col rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm transition-colors hover:border-[var(--psc-accent)] active:brightness-[0.99]"
    >
      {body}
    </Link>
  );
}

export default async function AdminHomePage() {
  const access = await requireStaffPanelPage();

  return (
    <div className="mx-auto max-w-6xl space-y-8 text-sm text-[var(--psc-muted)]">
      <header className="border-b border-[var(--psc-border)] pb-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Overview</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Staff dashboard</h2>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {OVERVIEW_CARDS.map((card) => (
          <li key={card.href}>
            <ToolCard card={card} access={access} />
          </li>
        ))}
      </ul>
    </div>
  );
}
