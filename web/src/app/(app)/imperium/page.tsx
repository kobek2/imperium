import Link from "next/link";
import { isProfileOnboardingComplete } from "@/lib/character-onboarding";
import { getServerAuth, tryCreateClient } from "@/lib/supabase/server";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";

type Snapshot = {
  players: number;
  activeElections: number;
  lawsPassed: number;
  activeBills: number;
  parties: number;
};

async function loadSnapshot(): Promise<Snapshot | null> {
  // Marketing counts must not rely on the visitor's JWT: RLS hides rows from anon users,
  // which incorrectly showed zeros. Prefer service role (server-only); fall back to session client.
  const supabase = createServiceRoleSupabase() ?? (await tryCreateClient());
  if (!supabase) return null;

  const [profiles, elections, laws, bills, partyOrgs] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("elections")
      .select("id", { count: "exact", head: true })
      .neq("phase", "closed")
      .is("leadership_role", null),
    supabase.from("bills").select("id", { count: "exact", head: true }).eq("status", "law"),
    supabase
      .from("bills")
      .select("id", { count: "exact", head: true })
      .in("status", ["submitted", "leadership_review", "on_docket", "debate", "house_floor", "senate_floor", "oval"]),
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
  const { supabase, user } = await getServerAuth();
  let isReadyForFullAccess = false;
  if (supabase && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("character_name, date_of_birth, residence_state, home_district_code, party")
      .eq("id", user.id)
      .maybeSingle();
    isReadyForFullAccess = isProfileOnboardingComplete(profile);
  }
  const joinHref = !user ? "/login" : isReadyForFullAccess ? "/" : "/onboarding";
  const joinLabel = !user ? "Join now" : isReadyForFullAccess ? "Enter Imperium" : "Finish character";

  return (
    <div className="space-y-10">
      <section className="overflow-hidden rounded-2xl border border-[var(--psc-border)] bg-[var(--psc-panel)] shadow-sm">
        <div className="relative">
          {/* Decorative hero art. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.unsplash.com/photo-1579965342575-16428a7c8881?auto=format&fit=crop&w=1800&q=80"
            alt="United States Capitol building"
            className="h-64 w-full object-cover object-center sm:h-80"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/35 to-transparent" />
          <div className="absolute inset-0 flex items-center justify-center p-6 sm:p-8">
            <div className="w-full max-w-3xl text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/85">
              Imperium
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
              Shape the future of the republic.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-white/90 sm:text-base">
              Campaign for office, negotiate in Congress, pass landmark legislation, and navigate
              federal budgets in a live political roleplay simulation.
            </p>
            <div className="mt-6 flex justify-center">
              <Link
                href={joinHref}
                className="rounded border-2 border-white/80 bg-white px-8 py-4 text-base font-bold uppercase tracking-[0.08em] text-slate-950 shadow-xl"
              >
                {joinLabel}
              </Link>
            </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {statCard("Players", snapshot ? snapshot.players.toLocaleString() : "—")}
        {statCard("Active elections", snapshot ? snapshot.activeElections.toLocaleString() : "—")}
        {statCard("Bills in motion", snapshot ? snapshot.activeBills.toLocaleString() : "—")}
        {statCard("Laws enacted", snapshot ? snapshot.lawsPassed.toLocaleString() : "—")}
        {statCard("Party orgs", snapshot ? snapshot.parties.toLocaleString() : "—")}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Become President</h2>
          <p className="mt-3 text-sm text-[var(--psc-muted)]">
            Build a national campaign, win the general election, and sign bills into law from the
            Oval Office.
          </p>
        </article>
        <article className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Join Congress</h2>
          <p className="mt-3 text-sm text-[var(--psc-muted)]">
            Run for House or Senate, lead your caucus, and influence every major vote on the floor.
          </p>
        </article>
        <article className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Write Major Bills</h2>
          <p className="mt-3 text-sm text-[var(--psc-muted)]">
            Draft legislation, negotiate amendments, and move proposals through both chambers to
            the President&apos;s desk.
          </p>
        </article>
      </section>

      <section className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-center text-lg font-semibold text-[var(--psc-ink)]">Start your path</h2>
        <p className="mt-2 text-center text-sm text-[var(--psc-muted)]">
          Access to gameplay tabs unlocks after sign-in and character onboarding. Create your
          character first, then all systems open automatically.
        </p>
        <div className="mt-4 flex justify-center">
          <Link
            href={joinHref}
            className="inline-flex items-center rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white"
          >
            {joinLabel}
          </Link>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 text-center">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Hall of Fame</h2>
        <p className="mx-auto mt-2 max-w-3xl text-sm text-[var(--psc-muted)]">
          Explore presidential legacies, term timelines, and defining achievements from Imperium&apos;s
          most influential leaders.
        </p>
        <div className="mt-4 flex justify-center">
          <Link
            href="/history"
            className="inline-flex items-center rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white"
          >
            Open Hall of Fame
          </Link>
        </div>
      </section>
    </div>
  );
}
