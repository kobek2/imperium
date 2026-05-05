import Link from "next/link";
import {
  closeLeadershipSessionNow,
  startLeadershipSession,
} from "@/app/actions/leadership-sessions";
import { SubmitButton } from "@/components/submit-button";

type SessionRow = {
  id: string;
  chamber: "house" | "senate";
  phase: "open" | "closed";
  majority_party: "democrat" | "republican" | "independent";
  opens_at: string;
  closes_at: string;
  closed_at: string | null;
};

function fmtCountdown(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "closing…";
  const hours = Math.floor(diff / (60 * 60 * 1000));
  const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h left`;
  }
  if (hours >= 1) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

function ChamberCard({
  chamber,
  session,
}: {
  chamber: "house" | "senate";
  session: SessionRow | null;
}) {
  const label = chamber === "house" ? "House" : "Senate";
  if (session) {
    return (
      <div className="border border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[var(--psc-ink)]">
            {label} leadership — live
          </p>
          <span className="font-mono text-xs text-[var(--psc-muted)]">
            {fmtCountdown(session.closes_at)}
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--psc-muted)]">
          Majority caucus at open: <strong>{session.majority_party}</strong>. Filing + voting open
          for every member of the {label.toLowerCase()}.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/congress/leadership/session/${session.id}`}
            className="border border-[var(--psc-border)] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide hover:border-[var(--psc-accent)]"
          >
            View session →
          </Link>
          <form action={closeLeadershipSessionNow}>
            <input type="hidden" name="session_id" value={session.id} />
            <SubmitButton
              pendingLabel="Closing…"
              className="border border-red-800 bg-red-950 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110"
            >
              End now + tally
            </SubmitButton>
          </form>
        </div>
      </div>
    );
  }
  return (
    <form
      action={startLeadershipSession}
      className="border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/40 p-4"
    >
      <input type="hidden" name="chamber" value={chamber} />
      <p className="text-sm font-semibold text-[var(--psc-ink)]">{label} leadership</p>
      <p className="mt-1 text-xs text-[var(--psc-muted)]">
        Toggle on to open a 24-hour window. Members of the {label.toLowerCase()} can file for a
        position AND vote during the same window. Per-role ties use earliest filer; which
        caucus is majority is set from seat counts when you start (see header note).
      </p>
      <SubmitButton
        pendingLabel="Starting…"
        className="mt-3 border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110"
      >
        Start {label.toLowerCase()} leadership election
      </SubmitButton>
    </form>
  );
}

export function LeadershipToggle({
  houseSession,
  senateSession,
  schemaMissing = false,
}: {
  houseSession: SessionRow | null;
  senateSession: SessionRow | null;
  schemaMissing?: boolean;
}) {
  return (
    <section className="space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-[var(--psc-ink)]">
          Leadership elections
        </h2>
        <span className="text-xs text-[var(--psc-muted)]">
          One open session per chamber. The simulation calendar also opens House and Senate sessions at
          inauguration and seating milestones (same window as before). Use this panel for manual runs or
          re-opens. Majority caucus = most seats; ties use delegation seniority (earliest chamber grants), then
          the party of the seated President.
        </span>
      </div>
      {schemaMissing ? (
        <div className="border border-amber-700 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          <p className="font-semibold">Migration required.</p>
          <p className="mt-1">
            The <code className="font-mono">leadership_sessions</code> tables aren&apos;t in this
            Supabase project yet. Run{" "}
            <code className="font-mono">
              supabase/migrations/20260428000000_leadership_sessions.sql
            </code>{" "}
            in the SQL editor and then execute{" "}
            <code className="font-mono">notify pgrst, &apos;reload schema&apos;;</code>.
          </p>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <ChamberCard chamber="house" session={houseSession} />
        <ChamberCard chamber="senate" session={senateSession} />
      </div>
    </section>
  );
}

export type { SessionRow as LeadershipSessionRow };
