import Link from "next/link";
import { redirect } from "next/navigation";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { tryCreateClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";

export default async function AdminElectionsPage() {
  if (!(await getIsAdmin())) redirect("/");

  const supabase = await tryCreateClient();
  if (!supabase) redirect("/");

  await runElectionPhaseSchedule(supabase);

  const { data: rows } = await supabase
    .from("elections")
    .select("id, office, state, district_code, phase, filing_opens_at, filing_closes_at")
    .order("filing_opens_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-[var(--psc-ink)]">Elections</h2>
        <Link
          href="/admin/elections/new"
          className="admin-cardlink border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white hover:brightness-110 active:brightness-90"
        >
          New race
        </Link>
      </div>

      {!rows?.length ? (
        <p className="text-sm text-[var(--psc-muted)]">No elections yet. Create one to get started.</p>
      ) : (
        <ul className="divide-y divide-[var(--psc-border)] border border-[var(--psc-border)] bg-[var(--psc-panel)]">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-mono text-xs text-[var(--psc-muted)]">{r.phase}</p>
                <p className="font-semibold">
                  {r.office.toUpperCase()} · {r.district_code ?? r.state ?? "Nationwide"}
                </p>
                <p className="text-xs text-[var(--psc-muted)]">
                  Filing {new Date(r.filing_opens_at).toLocaleString()} —{" "}
                  {new Date(r.filing_closes_at).toLocaleString()}
                </p>
              </div>
              <Link
                href={`/admin/elections/${r.id}`}
                className="admin-textlink text-sm font-semibold text-[var(--psc-accent)] underline decoration-2 underline-offset-2"
              >
                Operate
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
