import Link from "next/link";
import { redirect } from "next/navigation";
import { fetchCongressOverviewSnapshot } from "@/lib/congress-composition";
import { isLeadershipRole, leadershipRoleLabel, type LeadershipRole } from "@/lib/leadership";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";
import { OrientationTourPanelCongress } from "@/components/orientation-tour-panel";
import { ChamberHemicycle } from "./chamber-hemicycle";
import { CongressLeadersPanel } from "./congress-leaders-panel";
import {
  DEBATE_AUTO_FLOOR_HOURS,
  HOPPER_LEADERSHIP_HOURS,
  ON_DOCKET_AUTO_FLOOR_HOURS,
  OTHER_CHAMBER_REVIEW_HOURS,
} from "@/lib/legislation-automation-constants";

/** Small button-styled links (server component — use `Link`, not client `NavRouteButton`). */
const congressActionBtn =
  "inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--psc-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--psc-ink)] shadow-sm no-underline transition hover:bg-[var(--psc-canvas)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--psc-accent)] active:translate-y-px";

const congressActionBtnPrimary =
  "inline-flex shrink-0 items-center justify-center rounded-md border-2 border-[var(--psc-accent)] bg-[color-mix(in_srgb,var(--psc-accent)_14%,white)] px-3 py-1.5 text-xs font-bold text-[var(--psc-ink)] shadow-sm no-underline transition hover:bg-[color-mix(in_srgb,var(--psc-accent)_22%,white)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--psc-accent)] active:translate-y-px";

function leadershipOfficeRaceDeadlineIso(e: {
  phase: string;
  filing_closes_at: string;
  primary_closes_at: string | null;
  general_closes_at: string;
}): string {
  switch (e.phase) {
    case "filing":
      return e.filing_closes_at;
    case "primary":
      return e.primary_closes_at ?? e.general_closes_at;
    case "general":
      return e.general_closes_at;
    default:
      return e.general_closes_at;
  }
}

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
    .select("office_role, orientation_completed_at, orientation_step")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const isRep = roleKeys.includes("representative");
  const isSen = roleKeys.includes("senator");

  const [
    { data: leadershipSessions },
    snapshot,
    { data: reviewBills },
    { data: docketBills },
    { data: leadershipOfficeRaces },
  ] = await Promise.all([
    supabase.from("leadership_sessions").select("id, chamber, closes_at").eq("phase", "open"),
    fetchCongressOverviewSnapshot(supabase),
    supabase
      .from("bills")
      .select("id, title, originating_chamber, leadership_deadline_at")
      .in("status", ["submitted", "leadership_review"])
      .order("created_at", { ascending: true }),
    supabase
      .from("bills")
      .select("id, title, originating_chamber")
      .eq("status", "on_docket")
      .order("created_at", { ascending: true }),
    supabase
      .from("elections")
      .select(
        "id, office, phase, leadership_role, filing_opens_at, filing_closes_at, primary_closes_at, general_closes_at",
      )
      .not("leadership_role", "is", null)
      .neq("phase", "closed")
      .order("filing_opens_at", { ascending: false }),
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

  const officeRaceRows = (leadershipOfficeRaces ?? []) as Array<{
    id: string;
    office: string;
    phase: string;
    leadership_role: string | null;
    filing_opens_at: string;
    filing_closes_at: string;
    primary_closes_at: string | null;
    general_closes_at: string;
  }>;

  const officeRaceIds = officeRaceRows.map((r) => r.id);
  const candCountByElectionId: Record<string, number> = {};
  if (officeRaceIds.length) {
    const { data: candRows } = await supabase
      .from("election_candidates")
      .select("election_id")
      .in("election_id", officeRaceIds);
    for (const row of (candRows ?? []) as Array<{ election_id: string }>) {
      const id = row.election_id;
      candCountByElectionId[id] = (candCountByElectionId[id] ?? 0) + 1;
    }
  }

  if (!snapshot) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Could not load chamber composition.
      </div>
    );
  }

  const prof = profile as {
    office_role?: string | null;
    orientation_completed_at?: string | null;
    orientation_step?: number | null;
  } | null;
  const onStep3 = !prof?.orientation_completed_at && (prof?.orientation_step ?? 1) === 3;
  const orientationCongressBlock = onStep3 ? <OrientationTourPanelCongress /> : null;

  return (
    <div className="space-y-10">
      {orientationCongressBlock}
      <header>
        <h1 className="text-3xl font-semibold text-[var(--psc-ink)]">Congress overview</h1>
      </header>

      {officeRaceRows.length > 0 ? (
        <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Chamber office elections</h2>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Speaker, Senate Majority Leader, and other chamber-wide roles. File and vote on each race&apos;s page
            (House members for House races, Senators for Senate races).
          </p>
          <ul className="mt-4 divide-y divide-[var(--psc-border)] rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50">
            {officeRaceRows.map((r) => {
              const role = r.leadership_role;
              const title =
                role && isLeadershipRole(role) ? leadershipRoleLabel(role as LeadershipRole) : role ?? "Leadership";
              const deadline = leadershipOfficeRaceDeadlineIso(r);
              const n = candCountByElectionId[r.id] ?? 0;
              const phaseLabel = r.phase.charAt(0).toUpperCase() + r.phase.slice(1);
              return (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--psc-ink)]">{title}</p>
                    <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
                      {r.office === "house" ? "House" : r.office === "senate" ? "Senate" : r.office} · {phaseLabel} ·{" "}
                      {n} candidate{n === 1 ? "" : "s"} · current phase ends{" "}
                      {new Date(deadline).toLocaleString()}
                    </p>
                  </div>
                  <Link href={`/elections/${r.id}`} className={congressActionBtnPrimary}>
                    Open race →
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {reviewRows.length > 0 ? (
        <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Leadership review</h2>
            <Link href="/congress/leadership" className={congressActionBtnPrimary}>
              Open leadership desk →
            </Link>
          </div>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Newly filed measures await Speaker / Majority Leader (or Deputy) action. If nothing happens within{" "}
            {HOPPER_LEADERSHIP_HOURS} hours, each measure auto-advances to debate. Receiving-chamber review uses a{" "}
            {OTHER_CHAMBER_REVIEW_HOURS}-hour clock; on-docket bills use {ON_DOCKET_AUTO_FLOOR_HOURS} hours before a
            floor vote opens automatically. Debate runs on a {DEBATE_AUTO_FLOOR_HOURS}-hour window before a default
            floor ballot is scheduled.
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
                    {b.leadership_deadline_at
                      ? ` · Auto-advance ${new Date(b.leadership_deadline_at).toLocaleString()}`
                      : null}
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
          <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Caucus session ballots (Hopper)</h2>
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
          subheading="Deputy rotates to the Representative with the most personal economy collects (hourly income rows), excluding the Speaker. They may move hopper bills and open floor votes alongside the Speaker when timers fire."
          slots={snapshot.houseLeaders}
          shellClassName="border-[var(--psc-border)] bg-white"
          headingClassName="border-b border-[var(--psc-border)] bg-[var(--psc-panel)] text-[var(--psc-ink)]"
        />
        <CongressLeadersPanel
          heading="Senate leadership"
          subheading="Deputy rotates to the Senator with the most personal economy collects, excluding the Majority Leader. They backstop hopper review and floor scheduling the same way."
          slots={snapshot.senateLeaders}
          shellClassName="border-[var(--psc-border)] bg-white"
          headingClassName="border-b border-[var(--psc-border)] bg-[var(--psc-panel)] text-[var(--psc-ink)]"
        />
      </section>
    </div>
  );
}
