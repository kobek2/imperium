import Link from "next/link";
import { redirect } from "next/navigation";
import { adminStartPartyLeadershipFiling } from "@/app/actions/party";
import { LeadershipToggle, type LeadershipSessionRow } from "../elections/leadership-toggle";
import { SubmitButton } from "@/components/submit-button";
import { getServerAuth } from "@/lib/supabase/server";
import { requireStaffPanelPage, type StaffAccess } from "@/lib/staff-access";
import type { StaffPermission } from "@/lib/staff-permissions";

type OrgRow = {
  party_key: string;
  leadership_phase: string | null;
  leadership_filing_ends_at: string | null;
  next_leadership_election_opens_on_rp: string | null;
};

function canOpenRoute(
  access: StaffAccess,
  anyOf: readonly StaffPermission[] | null,
): boolean {
  if (anyOf === null || anyOf.length === 0) return true;
  if (access.hasFullStaff) return true;
  return anyOf.some((p) => access.permissions.has(p));
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function PartyElectionCard({ org, canOpen }: { org: OrgRow; canOpen: boolean }) {
  const label = org.party_key === "democrat" ? "Democratic Party" : "Republican Party";
  const phase = (org.leadership_phase ?? "idle").toLowerCase();
  const canStart = canOpen && phase === "idle";
  return (
    <div className="space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
      <h3 className="text-base font-semibold text-[var(--psc-ink)]">{label}</h3>
      <dl className="grid gap-2 text-xs text-[var(--psc-muted)]">
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="font-semibold text-[var(--psc-ink)]">Phase</dt>
          <dd className="capitalize">{phase === "open" ? "Election open (24h)" : phase}</dd>
        </div>
        {phase === "open" ? (
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="font-semibold text-[var(--psc-ink)]">Election closes</dt>
            <dd>{fmtWhen(org.leadership_filing_ends_at)}</dd>
          </div>
        ) : null}
        {phase === "idle" && org.next_leadership_election_opens_on_rp ? (
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="font-semibold text-[var(--psc-ink)]">Next scheduled (RP date)</dt>
            <dd className="font-mono">{org.next_leadership_election_opens_on_rp}</dd>
          </div>
        ) : null}
      </dl>
      <form action={adminStartPartyLeadershipFiling} className="border-t border-[var(--psc-border)] pt-4">
        <input type="hidden" name="party_key" value={org.party_key} />
        <p className="text-xs text-[var(--psc-muted)]">
          Opens a 24-hour election for chair, vice chair, and treasurer.
        </p>
        <SubmitButton
          disabled={!canStart}
          title={!canOpen ? "Requires parties grant." : !canStart ? "Election already open." : undefined}
          pendingLabel="Opening…"
          className="mt-3 border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
        >
          Start 24h election
        </SubmitButton>
      </form>
    </div>
  );
}

export default async function AdminLeadershipElectionsPage() {
  const access = await requireStaffPanelPage();
  const { supabase } = await getServerAuth();
  if (!supabase) redirect("/");

  const canManageCongressLeadership = canOpenRoute(access, ["elections", "simulation"]);
  const canManagePartyLeadership = canOpenRoute(access, ["parties"]);

  const [{ data: sessions, error: sessionsErr }, { data: orgs }] = await Promise.all([
    supabase
      .from("leadership_sessions")
      .select("id, chamber, phase, majority_party, opens_at, closes_at, closed_at")
      .eq("phase", "open"),
    supabase
      .from("party_organizations")
      .select("party_key, leadership_phase, leadership_filing_ends_at, next_leadership_election_opens_on_rp")
      .in("party_key", ["democrat", "republican"])
      .order("party_key", { ascending: true }),
  ]);

  const leadershipSchemaMissing =
    !!sessionsErr &&
    (sessionsErr.message.toLowerCase().includes("leadership_sessions") || sessionsErr.code === "PGRST205");
  const sessionRows = (sessions ?? []) as LeadershipSessionRow[];
  const houseSession = sessionRows.find((s) => s.chamber === "house") ?? null;
  const senateSession = sessionRows.find((s) => s.chamber === "senate") ?? null;

  const partyRows = (orgs ?? []) as OrgRow[];
  const dem = partyRows.find((r) => r.party_key === "democrat");
  const rep = partyRows.find((r) => r.party_key === "republican");
  const nowIso = new Date().toISOString();
  const [
    { count: overdueOpenLeadershipSessions },
    { count: staleOpenElectionLeadershipRows },
    { count: stalledHouseFloorBills },
    { count: stalledSenateFloorBills },
  ] = await Promise.all([
    supabase
      .from("leadership_sessions")
      .select("*", { count: "exact", head: true })
      .eq("phase", "open")
      .lt("closes_at", nowIso),
    supabase
      .from("elections")
      .select("*", { count: "exact", head: true })
      .not("leadership_role", "is", null)
      .in("phase", ["filing", "primary", "general"]),
    supabase
      .from("bills")
      .select("*", { count: "exact", head: true })
      .eq("status", "house_floor")
      .is("chamber_vote_deadline_at", null),
    supabase
      .from("bills")
      .select("*", { count: "exact", head: true })
      .eq("status", "senate_floor")
      .is("chamber_vote_deadline_at", null)
      .eq("vp_tie_break_pending", false),
  ]);
  const diagnostics = [
    {
      label: "Overdue open leadership sessions",
      count: Number(overdueOpenLeadershipSessions ?? 0),
      hint: "Should be 0 after month advance or session schedule tick.",
    },
    {
      label: "Legacy open election leadership rows",
      count: Number(staleOpenElectionLeadershipRows ?? 0),
      hint: "Should stay 0 with leadership_sessions-based flow.",
    },
    {
      label: "House floor bills without vote timer",
      count: Number(stalledHouseFloorBills ?? 0),
      hint: "Should be 0; floor bills normally carry a 24h deadline.",
    },
    {
      label: "Senate floor bills without timer (non tie-break)",
      count: Number(stalledSenateFloorBills ?? 0),
      hint: "Should be 0 unless waiting on VP tie-break.",
    },
  ];

  return (
    <div className="max-w-5xl space-y-8 text-sm">
      <header className="border-b border-[var(--psc-border)] pb-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Administration</p>
        <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Leadership elections</h1>
        <p className="mt-2 text-[var(--psc-muted)]">
          Open leadership elections for Congress and party officers from one module.
        </p>
      </header>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Congress leadership</h2>
          <Link href="/admin/elections" className="text-xs font-semibold text-[var(--psc-accent)] underline">
            Elections console
          </Link>
        </div>
        {!canManageCongressLeadership ? (
          <p className="rounded border border-dashed border-amber-800/40 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            Requires elections or simulation grant.
          </p>
        ) : (
          <LeadershipToggle
            houseSession={houseSession}
            senateSession={senateSession}
            schemaMissing={leadershipSchemaMissing}
          />
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Party leadership</h2>
        {!canManagePartyLeadership ? (
          <p className="rounded border border-dashed border-amber-800/40 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            Requires parties grant.
          </p>
        ) : dem && rep ? (
          <div className="grid gap-4 md:grid-cols-2">
            <PartyElectionCard org={dem} canOpen={canManagePartyLeadership} />
            <PartyElectionCard org={rep} canOpen={canManagePartyLeadership} />
          </div>
        ) : (
          <p className="text-[var(--psc-muted)]">Could not load party leadership state.</p>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Integrity checks</h2>
        <p className="text-xs text-[var(--psc-muted)]">
          Quick diagnostics for leadership and bill pipeline invariants in baseline mode.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {diagnostics.map((item) => {
            const isClean = item.count === 0;
            return (
              <article
                key={item.label}
                className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3"
              >
                <p className="text-sm font-semibold text-[var(--psc-ink)]">{item.label}</p>
                <p
                  className={`mt-1 font-mono text-xl ${
                    isClean ? "text-emerald-700" : "text-amber-700"
                  }`}
                >
                  {item.count}
                </p>
                <p className="mt-1 text-xs text-[var(--psc-muted)]">{item.hint}</p>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
