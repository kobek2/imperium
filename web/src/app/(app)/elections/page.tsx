import Link from "next/link";
import { redirect } from "next/navigation";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { tryCreateClient } from "@/lib/supabase/server";

type ElectionRow = {
  id: string;
  office: string;
  phase: string;
  filing_opens_at: string;
  filing_closes_at: string;
  district_code: string | null;
  state: string | null;
};

const PHASE_ORDER = ["filing", "primary", "general", "closed"] as const;

function phaseRank(p: string) {
  const i = PHASE_ORDER.indexOf(p as (typeof PHASE_ORDER)[number]);
  return i === -1 ? 99 : i;
}

function sortByPhaseThenDate(a: ElectionRow, b: ElectionRow) {
  const pd = phaseRank(a.phase) - phaseRank(b.phase);
  if (pd !== 0) return pd;
  return new Date(b.filing_opens_at).getTime() - new Date(a.filing_opens_at).getTime();
}

function RaceCard({ e }: { e: ElectionRow }) {
  const label = e.district_code ?? e.state ?? "Nationwide";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-3 text-sm shadow-sm transition hover:border-[var(--psc-accent)]/60 hover:shadow">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">{e.phase}</p>
        <p className="font-semibold text-[var(--psc-ink)]">{label}</p>
        <p className="text-xs text-[var(--psc-muted)]">
          Filing {new Date(e.filing_opens_at).toLocaleDateString()} —{" "}
          {new Date(e.filing_closes_at).toLocaleDateString()}
        </p>
      </div>
      <Link
        href={`/elections/${e.id}`}
        className="shrink-0 rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110 active:brightness-90"
      >
        Open race
      </Link>
    </li>
  );
}

function OfficeBlock({
  title,
  rows,
}: {
  title: string;
  rows: ElectionRow[];
}) {
  if (!rows.length) return null;
  const filing = rows.filter((r) => r.phase === "filing").sort(sortByPhaseThenDate);
  const primary = rows.filter((r) => r.phase === "primary").sort(sortByPhaseThenDate);
  const general = rows.filter((r) => r.phase === "general").sort(sortByPhaseThenDate);
  const closed = rows.filter((r) => r.phase === "closed").sort(sortByPhaseThenDate);

  return (
    <section className="space-y-4">
      <h2 className="border-b border-[var(--psc-border)] pb-2 text-lg font-semibold text-[var(--psc-ink)]">
        {title}
      </h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <PhaseColumn label="Filing" elections={filing} empty="No races in filing." />
        <PhaseColumn label="Primary" elections={primary} empty="No primaries right now." />
        <PhaseColumn label="General" elections={general} empty="No general elections right now." />
        <PhaseColumn label="Closed" elections={closed} empty="No closed races in this chamber." />
      </div>
    </section>
  );
}

function PhaseColumn({
  label,
  elections,
  empty,
}: {
  label: string;
  elections: ElectionRow[];
  empty: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">{label}</h3>
      {!elections.length ? (
        <p className="mt-3 text-xs text-[var(--psc-muted)]">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {elections.map((e) => (
            <RaceCard key={e.id} e={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function ElectionsPage() {
  const supabase = await tryCreateClient();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to load election data.
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await runElectionPhaseSchedule(supabase);

  const { data: elections } = await supabase
    .from("elections")
    .select("id, office, phase, filing_opens_at, filing_closes_at, district_code, state")
    .order("filing_opens_at", { ascending: false });

  const rows = (elections ?? []) as ElectionRow[];
  const house = rows.filter((e) => e.office === "house");
  const senate = rows.filter((e) => e.office === "senate");
  const president = rows.filter((e) => e.office === "president");

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold">Election operations</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--psc-muted)]">
          Races are grouped by chamber and phase. Use <strong>Open race</strong> for filing, primary, and
          general ballots. Primaries list only candidates in <strong>your</strong> party for each seat.
        </p>
      </header>

      {!rows.length ? (
        <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <p className="text-sm text-[var(--psc-muted)]">
            No races scheduled yet. Admins can create elections under{" "}
            <Link href="/admin/elections" className="font-semibold text-[var(--psc-accent)] underline">
              Admin → Elections
            </Link>
            .
          </p>
        </section>
      ) : (
        <div className="space-y-12">
          <OfficeBlock title="House of Representatives" rows={house} />
          <OfficeBlock title="Senate" rows={senate} />
          <OfficeBlock title="President" rows={president} />
        </div>
      )}
    </div>
  );
}
