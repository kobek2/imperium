import Link from "next/link";
import { getServerAuth } from "@/lib/supabase/server";

type Snapshot = {
  players: number;
  activeElections: number;
  lawsPassed: number;
  activeBills: number;
  parties: number;
};

async function loadSnapshot(): Promise<Snapshot | null> {
  const { supabase } = await getServerAuth();
  if (!supabase) return null;

  const [profiles, elections, laws, bills, partyOrgs] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("elections").select("id", { count: "exact", head: true }).neq("phase", "closed"),
    supabase.from("bills").select("id", { count: "exact", head: true }).eq("status", "law"),
    supabase
      .from("bills")
      .select("id", { count: "exact", head: true })
      .in("status", ["submitted", "on_docket", "debate", "house_floor", "senate_floor", "oval"]),
    supabase.from("party_organizations").select("party_key", { count: "exact", head: true }),
  ]);

  return {
    players: profiles.count ?? 0,
    activeElections: elections.count ?? 0,
    lawsPassed: laws.count ?? 0,
    activeBills: bills.count ?? 0,
    parties: partyOrgs.count ?? 0,
  };
}

function statCard(label: string, value: string) {
  return (
    <div className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--psc-muted)]">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-[var(--psc-ink)]">{value}</p>
    </div>
  );
}

export default async function ImperiumLandingPage() {
  const snapshot = await loadSnapshot();

  return (
    <div className="space-y-10">
      <section className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-7 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--psc-muted)]">Imperium</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--psc-ink)]">
          Federal power, political strategy, and live roleplay.
        </h1>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-[var(--psc-muted)]">
          Imperium is a U.S. federal simulation where players run campaigns, write and pass legislation, manage party
          institutions, operate cabinet powers, and steer a live fiscal-economy system from draft budgets to
          appropriations law.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/elections"
            className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white"
          >
            Enter elections
          </Link>
          <Link
            href="/congress"
            className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)]"
          >
            Open Congress
          </Link>
          <Link
            href="/economy/federal"
            className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)]"
          >
            Federal budget
          </Link>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {statCard("Players", snapshot ? snapshot.players.toLocaleString() : "—")}
        {statCard("Active elections", snapshot ? snapshot.activeElections.toLocaleString() : "—")}
        {statCard("Bills in motion", snapshot ? snapshot.activeBills.toLocaleString() : "—")}
        {statCard("Laws enacted", snapshot ? snapshot.lawsPassed.toLocaleString() : "—")}
        {statCard("Party orgs", snapshot ? snapshot.parties.toLocaleString() : "—")}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">How the simulation works</h2>
          <ul className="mt-3 space-y-2 text-sm text-[var(--psc-muted)]">
            <li>Character setup defines party identity, geography, and in-world profile.</li>
            <li>Elections run through Filing, Primary, and General with campaign actions and endorsements.</li>
            <li>Bills move through leadership review, debate, chamber floor votes, and Oval sign/veto.</li>
            <li>Inbox + Congressional Chat keep players synced on role-critical updates.</li>
          </ul>
        </article>
        <article className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Economy and governance loop</h2>
          <ul className="mt-3 space-y-2 text-sm text-[var(--psc-muted)]">
            <li>Players earn salary and PAC income, then invest in races or party operations.</li>
            <li>Federal budget drafts set tax brackets plus line-item spending minima and allocations.</li>
            <li>Appropriations law and fiscal-year close determine treasury health and macro pressure.</li>
            <li>Cabinet and party leadership decisions directly shape institutional outcomes.</li>
          </ul>
        </article>
      </section>

      <section className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Start your path</h2>
        <p className="mt-2 text-sm text-[var(--psc-muted)]">
          New to the sim? Build your identity, pick your lane, and start influencing outcomes across elections,
          Congress, and the federal economy.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
          <Link className="rounded border border-[var(--psc-border)] bg-white px-3 py-2 text-[var(--psc-ink)]" href="/character">
            Character
          </Link>
          <Link className="rounded border border-[var(--psc-border)] bg-white px-3 py-2 text-[var(--psc-ink)]" href="/parties">
            Parties
          </Link>
          <Link className="rounded border border-[var(--psc-border)] bg-white px-3 py-2 text-[var(--psc-ink)]" href="/inbox">
            Inbox
          </Link>
          <Link className="rounded border border-[var(--psc-border)] bg-white px-3 py-2 text-[var(--psc-ink)]" href="/directory">
            Directory
          </Link>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">History & Hall of Fame</h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--psc-muted)]">
          Explore presidential history in Imperium: winners by era, major career markers, and a hall-of-fame ranking
          based on election success and governing impact.
        </p>
        <div className="mt-4">
          <Link
            href="/history"
            className="inline-flex items-center rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white"
          >
            Open history page
          </Link>
        </div>
      </section>
    </div>
  );
}
