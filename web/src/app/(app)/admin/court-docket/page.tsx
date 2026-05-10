import Link from "next/link";
import { requireStaffPage } from "@/lib/staff-access";
import { getServerAuth } from "@/lib/supabase/server";

export default async function AdminCourtDocketPage() {
  await requireStaffPage("simulation");
  const { supabase } = await getServerAuth();
  if (!supabase) {
    return (
      <p className="text-sm text-[var(--psc-muted)]">
        Configure Supabase to load the court docket.
      </p>
    );
  }

  const { data: rows, error } = await supabase
    .from("rp_court_cases")
    .select(
      "id, archetype_key, case_label, topic, status, side_taken, outcome_tier, outcome_summary, public_confidence_delta, presidential_directive, target_bill_id, opens_at, closes_at, argued_by, argued_at, agenda",
    )
    .order("opens_at", { ascending: false })
    .limit(60);

  const list = (rows ?? []) as Array<{
    id: string;
    archetype_key: string;
    case_label: string;
    topic: string;
    status: string;
    side_taken: string | null;
    outcome_tier: string | null;
    outcome_summary: string | null;
    public_confidence_delta: number | null;
    presidential_directive: string | null;
    target_bill_id: string | null;
    opens_at: string;
    closes_at: string;
    argued_by: string | null;
    argued_at: string | null;
    agenda: unknown;
  }>;

  return (
    <div className="max-w-4xl space-y-6 text-sm">
      <header className="space-y-2">
        <Link href="/admin" className="text-xs font-semibold text-[var(--psc-accent)] underline">
          ← Admin home
        </Link>
        <h1 className="text-xl font-semibold text-[var(--psc-ink)]">Court docket log</h1>
        <p className="text-[var(--psc-muted)]">
          Recent Attorney General docket activity — open cases, presidential directives, and rulings (including
          default-loss expirations). Useful for staging RP fallout and verifying the auto-tick.
        </p>
      </header>

      {error ? (
        <p className="rounded border border-amber-700 bg-amber-50 p-3 text-amber-950">
          {error.message} — ensure migration{" "}
          <code className="font-mono">20260517120000_attorney_general_court_docket.sql</code> is applied.
        </p>
      ) : null}

      <ul className="space-y-3">
        {list.map((r) => (
          <li
            key={r.id}
            className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold text-[var(--psc-ink)]">
                {r.case_label}
              </span>
              <span className="font-mono text-xs text-[var(--psc-muted)]">
                opened {r.opens_at} · closes {r.closes_at}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--psc-muted)]">
              {r.topic} · status <span className="font-mono">{r.status}</span>
              {r.side_taken ? ` · posture ${r.side_taken}` : ""}
              {r.outcome_tier ? ` · outcome ${r.outcome_tier}` : ""}
              {r.public_confidence_delta != null && r.public_confidence_delta !== 0
                ? ` · Δ confidence ${r.public_confidence_delta > 0 ? "+" : ""}${r.public_confidence_delta}`
                : ""}
              {r.presidential_directive ? ` · directive ${r.presidential_directive}` : ""}
              {r.target_bill_id ? ` · linked bill ${r.target_bill_id.slice(0, 8)}` : ""}
            </p>
            {r.outcome_summary ? (
              <p className="mt-2 text-xs leading-snug text-[var(--psc-ink)]">{r.outcome_summary}</p>
            ) : null}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-[var(--psc-accent)]">Agenda JSON</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-[var(--psc-canvas)] p-2 text-[11px] leading-snug text-[var(--psc-ink)]">
                {JSON.stringify(r.agenda, null, 2)}
              </pre>
            </details>
          </li>
        ))}
      </ul>

      {!error && list.length === 0 ? (
        <p className="text-[var(--psc-muted)]">No court cases recorded yet.</p>
      ) : null}
    </div>
  );
}
