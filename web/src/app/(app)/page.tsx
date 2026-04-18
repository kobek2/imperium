import Link from "next/link";

const TILES = [
  {
    href: "/character",
    title: "Character",
    subtitle: "Name, party, home district.",
  },
  {
    href: "/elections",
    title: "Elections",
    subtitle: "File, vote, follow live races.",
  },
  {
    href: "/congress",
    title: "Congress",
    subtitle: "Bill hopper and chamber votes.",
  },
  {
    href: "/oval",
    title: "Oval Office",
    subtitle: "Sign, veto, appoint.",
  },
];

export default function BriefingPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">
          Command center
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--psc-muted)]">
          Pick a module to get started.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TILES.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="flex h-full flex-col justify-between rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 transition hover:border-[var(--psc-accent)] hover:shadow"
          >
            <p className="text-base font-semibold text-[var(--psc-ink)]">{t.title}</p>
            <p className="mt-2 text-sm text-[var(--psc-muted)]">{t.subtitle}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
