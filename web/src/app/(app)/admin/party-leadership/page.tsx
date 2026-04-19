import Link from "next/link";
import { redirect } from "next/navigation";
import { adminStartPartyLeadershipFiling } from "@/app/actions/party";
import { SubmitButton } from "@/components/submit-button";
import { tryCreateClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";

type OrgRow = {
  party_key: string;
  leadership_phase: string | null;
  leadership_filing_ends_at: string | null;
  leadership_voting_ends_at: string | null;
  next_leadership_election_opens_on_rp: string | null;
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function PartyCard({ org }: { org: OrgRow }) {
  const label = org.party_key === "democrat" ? "Democratic Party" : "Republican Party";
  const phase = (org.leadership_phase ?? "idle").toLowerCase();
  const canOpen = phase === "idle";
  return (
    <div className="space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
      <h2 className="text-base font-semibold text-[var(--psc-ink)]">{label}</h2>
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
          Starts a 24-hour leadership election for chair, vice chair, and treasurer (run, withdraw, vote). Clears any
          in-progress candidacies and votes for this party. Not available while an election is already open.
        </p>
        <SubmitButton
          disabled={!canOpen}
          title={!canOpen ? "Wait until the party is idle, or let the current election finish." : undefined}
          pendingLabel="Opening…"
          className="mt-3 border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
        >
          Start 24h leadership election
        </SubmitButton>
      </form>
    </div>
  );
}

export default async function AdminPartyLeadershipPage() {
  if (!(await getIsAdmin())) redirect("/");

  const supabase = await tryCreateClient();
  if (!supabase) redirect("/");

  const { data: orgs, error } = await supabase
    .from("party_organizations")
    .select(
      "party_key, leadership_phase, leadership_filing_ends_at, leadership_voting_ends_at, next_leadership_election_opens_on_rp",
    )
    .in("party_key", ["democrat", "republican"])
    .order("party_key", { ascending: true });

  const schemaMissing =
    !!error &&
    (error.message.toLowerCase().includes("next_leadership_election_opens_on_rp") ||
      error.message.toLowerCase().includes("party_organizations") ||
      error.code === "PGRST204" ||
      error.code === "PGRST205");

  const rows = (orgs ?? []) as OrgRow[];
  const dem = rows.find((r) => r.party_key === "democrat");
  const rep = rows.find((r) => r.party_key === "republican");

  return (
    <div className="max-w-3xl space-y-6 text-sm">
      <nav className="text-xs">
        <Link href="/admin" className="font-semibold text-[var(--psc-accent)] underline">
          ← Admin overview
        </Link>
      </nav>
      <header>
        <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Party leadership (DNC / RNC)</h1>
        <p className="mt-2 text-[var(--psc-muted)]">
          Chair, vice chair, and treasurer: open a 24-hour election manually instead of waiting for the biennial RP
          schedule. Players run and vote on each party&apos;s{" "}
          <Link href="/parties/democrat" className="text-[var(--psc-accent)] underline">
            Democratic
          </Link>{" "}
          or{" "}
          <Link href="/parties/republican" className="text-[var(--psc-accent)] underline">
            Republican
          </Link>{" "}
          room.
        </p>
      </header>

      {schemaMissing ? (
        <div className="border border-amber-700 bg-amber-50 p-4 text-xs text-amber-950">
          <p className="font-semibold">Migration required.</p>
          <p className="mt-1">
            Apply party leadership migrations (including{" "}
            <code className="font-mono">20260445000000_party_leadership_rp_calendar.sql</code> and{" "}
            <code className="font-mono">20260446000000_party_admin_start_leadership_filing.sql</code>,{" "}
            <code className="font-mono">20260447000000_party_leadership_24h_open_phase.sql</code>
            ), then reload the API schema.
          </p>
        </div>
      ) : null}

      {dem && rep ? (
        <div className="grid gap-4 md:grid-cols-2">
          <PartyCard org={dem} />
          <PartyCard org={rep} />
        </div>
      ) : (
        <p className="text-[var(--psc-muted)]">Could not load party organizations.</p>
      )}
    </div>
  );
}
