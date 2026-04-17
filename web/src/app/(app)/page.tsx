import Link from "next/link";

export default function BriefingPage() {
  return (
    <div className="grid gap-10 lg:grid-cols-[2fr,1fr]">
      <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-8">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--psc-ink)]">
          Operational briefing
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-[var(--psc-muted)]">
          This console automates filing windows, primaries, the 60/40 FEC scoring
          model, hopper traffic, chamber votes, and Oval Office actions. Discord
          remains the venue for speeches, graphics, and coalition building; the
          site enforces structure, deadlines, and math.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link
            href="/character"
            className="border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-4 text-sm font-semibold hover:border-[var(--psc-accent)]"
          >
            Character & district claim
          </Link>
          <Link
            href="/elections"
            className="border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-4 text-sm font-semibold hover:border-[var(--psc-accent)]"
          >
            Election cycles
          </Link>
          <Link
            href="/congress"
            className="border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-4 text-sm font-semibold hover:border-[var(--psc-accent)]"
          >
            Bill hopper & chambers
          </Link>
          <Link
            href="/oval"
            className="border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-4 text-sm font-semibold hover:border-[var(--psc-accent)]"
          >
            Executive desk
          </Link>
        </div>
      </section>
      <aside className="border border-dashed border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 text-sm text-[var(--psc-muted)]">
        <p className="font-semibold text-[var(--psc-ink)]">Time scale</p>
        <p className="mt-3 leading-relaxed">
          Admins drive election phases from <strong>Admin → Elections</strong>. The
          default design still assumes short filing and primary windows, generals
          resolving on your schedule, and bills auto-expiring after 24 hours unless
          advanced.
        </p>
      </aside>
    </div>
  );
}
