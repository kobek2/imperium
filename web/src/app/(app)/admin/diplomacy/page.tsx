import Link from "next/link";
import { requireStaffPage } from "@/lib/staff-access";
import { getServerAuth } from "@/lib/supabase/server";

export default async function AdminDiplomacyPage() {
  await requireStaffPage("simulation");
  const { supabase } = await getServerAuth();
  if (!supabase) {
    return (
      <p className="text-sm text-[var(--psc-muted)]">
        Configure Supabase to load diplomacy sessions.
      </p>
    );
  }

  const { data: rows, error } = await supabase
    .from("rp_diplomatic_sessions")
    .select("id, user_id, nation_code, mode, status, hours_committed, outcome_rating, relation_delta, created_at, agenda, choice_path")
    .order("created_at", { ascending: false })
    .limit(80);

  const list = (rows ?? []) as Array<{
    id: string;
    user_id: string;
    nation_code: string;
    mode: string;
    status: string;
    hours_committed: number;
    outcome_rating: number | null;
    relation_delta: number | null;
    created_at: string;
    agenda: unknown;
    choice_path: number[] | null;
  }>;

  return (
    <div className="max-w-4xl space-y-6 text-sm">
      <header className="space-y-2">
        <Link href="/admin" className="text-xs font-semibold text-[var(--psc-accent)] underline">
          ← Admin home
        </Link>
        <h1 className="text-xl font-semibold text-[var(--psc-ink)]">Diplomacy session log</h1>
        <p className="text-[var(--psc-muted)]">
          Recent Secretary of State engagements (passive blocks and intensive dialogues). Choice paths and agendas help
          stage server-side RP without exposing the raw game table to everyone.
        </p>
      </header>

      {error ? (
        <p className="rounded border border-amber-700 bg-amber-50 p-3 text-amber-950">
          {error.message} — ensure migration <code className="font-mono">20260515120000_cabinet_daily_hours_diplomacy.sql</code>{" "}
          is applied.
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
                {r.nation_code} · {r.mode}
              </span>
              <span className="font-mono text-xs text-[var(--psc-muted)]">{r.created_at}</span>
            </div>
            <p className="mt-1 text-xs text-[var(--psc-muted)]">
              user <span className="font-mono">{r.user_id}</span> · {r.status} · {r.hours_committed}h
              {r.outcome_rating != null ? ` · rated ${r.outcome_rating}/5` : ""}
              {r.relation_delta != null ? ` · Δ${r.relation_delta}` : ""}
            </p>
            {r.mode === "intensive" && Array.isArray(r.choice_path) && r.choice_path.length === 3 ? (
              <p className="mt-2 text-xs text-[var(--psc-muted)]">
                Choice path:{" "}
                <span className="font-mono">
                  [{r.choice_path.join(", ")}]
                </span>
              </p>
            ) : null}
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-[var(--psc-canvas)] p-2 text-[11px] leading-snug text-[var(--psc-ink)]">
              {JSON.stringify(r.agenda, null, 2)}
            </pre>
          </li>
        ))}
      </ul>

      {!error && list.length === 0 ? (
        <p className="text-[var(--psc-muted)]">No diplomatic sessions recorded yet.</p>
      ) : null}
    </div>
  );
}
