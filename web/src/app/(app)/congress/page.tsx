import Link from "next/link";
import { redirect } from "next/navigation";
import { fetchCongressOverviewSnapshot } from "@/lib/congress-composition";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";
import { ChamberHemicycle } from "./chamber-hemicycle";
import { CongressLeadersPanel } from "./congress-leaders-panel";

/** Small button-styled links (server component — use `Link`, not client `NavRouteButton`). */
const congressActionBtn =
  "inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--psc-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--psc-ink)] shadow-sm no-underline transition hover:bg-[var(--psc-canvas)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--psc-accent)] active:translate-y-px";

const congressActionBtnPrimary =
  "inline-flex shrink-0 items-center justify-center rounded-md border-2 border-[var(--psc-accent)] bg-[color-mix(in_srgb,var(--psc-accent)_14%,white)] px-3 py-1.5 text-xs font-bold text-[var(--psc-ink)] shadow-sm no-underline transition hover:bg-[color-mix(in_srgb,var(--psc-accent)_22%,white)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--psc-accent)] active:translate-y-px";

export default async function CongressOverviewPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to open the hopper.
      </div>
    );
  }

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const isRep = roleKeys.includes("representative");
  const isSen = roleKeys.includes("senator");

  const [{ data: leadershipSessions }, snapshot, { data: reviewBills }, { data: docketBills }] = await Promise.all([
    supabase.from("leadership_sessions").select("id, chamber, closes_at").eq("phase", "open"),
    fetchCongressOverviewSnapshot(supabase),
    supabase
      .from("bills")
      .select("id, title, originating_chamber, leadership_deadline_at")
      .eq("status", "submitted")
      .order("created_at", { ascending: true }),
    supabase
      .from("bills")
      .select("id, title, originating_chamber")
      .eq("status", "on_docket")
      .order("created_at", { ascending: true }),
  ]);

  const sessions = (leadershipSessions ?? []) as Array<{ id: string; chamber: string; closes_at: string }>;
  const openHouseSessions = sessions.filter((s) => s.chamber === "house");
  const openSenateSessions = sessions.filter((s) => s.chamber === "senate");

  const reviewRows = (reviewBills ?? []) as Array<{
    id: string;
    title: string;
    originating_chamber: "house" | "senate";
    leadership_deadline_at: string | null;
  }>;

  const docketRows = (docketBills ?? []) as Array<{
    id: string;
    title: string;
    originating_chamber: "house" | "senate";
  }>;

  if (!snapshot) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Could not load chamber composition.
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold text-[var(--psc-ink)]">Congress overview</h1>
      </header>

      {reviewRows.length > 0 ? (
        <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Leadership review</h2>
            <Link href="/congress/leadership" className={congressActionBtnPrimary}>
              Open leadership desk →
            </Link>
          </div>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Newly filed measures awaiting Speaker / Majority Leader action before they go on the docket.
          </p>
          <ul className="mt-4 divide-y divide-[var(--psc-border)] rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50">
            {reviewRows.map((b) => (
              <li key={b.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/bill/${b.id}`}
                    className="text-sm font-semibold text-[var(--psc-ink)] hover:underline"
                  >
                    {b.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
                    {b.originating_chamber === "house" ? "House" : "Senate"}
                    
                  </p>
                </div>
                <Link
                  href={b.originating_chamber === "house" ? "/congress/house" : "/congress/senate"}
                  className={congressActionBtn}
                >
                  Chamber tab →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {docketRows.length > 0 ? (
        <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--psc-ink)]">On leadership docket</h2>
            <Link href="/congress/leadership" className={congressActionBtnPrimary}>
              Open voting →
            </Link>
          </div>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Accepted to the docket — leadership can open a floor vote when ready.
          </p>
          <ul className="mt-4 divide-y divide-[var(--psc-border)] rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50">
            {docketRows.map((b) => (
              <li key={b.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/bill/${b.id}`}
                    className="text-sm font-semibold text-[var(--psc-ink)] hover:underline"
                  >
                    {b.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
                    {b.originating_chamber === "house" ? "House" : "Senate"}
                  </p>
                </div>
                <Link href={`/bill/${b.id}`} className={congressActionBtn}>
                  Bill page →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(openHouseSessions.length > 0 || openSenateSessions.length > 0) && (
        <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Leadership elections</h2>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Ballots stay on each chamber&apos;s tab so only members of that chamber can vote.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {openHouseSessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[var(--psc-muted)]">
                  House · closes {new Date(s.closes_at).toLocaleString()}
                </span>
                {isRep ? (
                  <Link href={`/congress/leadership/session/${s.id}`} className={congressActionBtnPrimary}>
                    House ballot →
                  </Link>
                ) : (
                  <span className="text-xs text-[var(--psc-muted)]">House members only</span>
                )}
              </li>
            ))}
            {openSenateSessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[var(--psc-muted)]">
                  Senate · closes {new Date(s.closes_at).toLocaleString()}
                </span>
                {isSen ? (
                  <Link href={`/congress/leadership/session/${s.id}`} className={congressActionBtnPrimary}>
                    Senate ballot →
                  </Link>
                ) : (
                  <span className="text-xs text-[var(--psc-muted)]">Senators only</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-8 lg:grid-cols-2">
        <ChamberHemicycle title="House of Representatives" counts={snapshot.house.counts} />
        <ChamberHemicycle title="United States Senate" counts={snapshot.senate.counts} />
      </section>

      <section className="grid gap-8 lg:grid-cols-2 lg:items-start">
        <CongressLeadersPanel
          heading="House leadership"
          slots={snapshot.houseLeaders}
          shellClassName="border-[var(--psc-border)] bg-white"
          headingClassName="border-b border-[var(--psc-border)] bg-[var(--psc-panel)] text-[var(--psc-ink)]"
        />
        <CongressLeadersPanel
          heading="Senate leadership"
          slots={snapshot.senateLeaders}
          shellClassName="border-[var(--psc-border)] bg-white"
          headingClassName="border-b border-[var(--psc-border)] bg-[var(--psc-panel)] text-[var(--psc-ink)]"
        />
      </section>
    </div>
  );
}
