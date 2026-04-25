import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PolicyRow = {
  issue_key: string;
  current_stance_key: string | null;
  current_policy_value: number | null;
  last_changed_at: string | null;
  last_changed_by_bill_id: string | null;
  history: unknown;
  bill_templates?: { display_name: string; description: string | null } | null;
};

type HistoryEntry = {
  stance_key?: string;
  date?: string;
  bill_id?: string;
  bill_title?: string;
};

function spectrumPct(v: number | null | undefined): number {
  if (v == null || Number.isNaN(v)) return 50;
  return Math.max(0, Math.min(100, ((Number(v) + 2) / 4) * 100));
}

export default async function PolicyPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) redirect("/");
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("policy_status")
    .select("issue_key, current_stance_key, current_policy_value, last_changed_at, last_changed_by_bill_id, history")
    .order("last_changed_at", { ascending: false, nullsFirst: false });

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-amber-900">
        Policy data is unavailable. Apply migrations including `20260472000000_legislative_overhaul.sql` and seed file.
        <p className="mt-2 text-xs">{error.message}</p>
      </div>
    );
  }

  const rows = (data ?? []) as PolicyRow[];

  const { data: tpls } = await supabase.from("bill_templates").select("issue_key, display_name, description, stances");
  const tplByKey = new Map(
    (tpls ?? []).map((t) => [
      String((t as { issue_key: string }).issue_key),
      t as { display_name: string; description: string | null; stances: unknown },
    ]),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-6">
      <header>
        <h1 className="text-3xl font-semibold text-[var(--psc-ink)]">Law of the land</h1>
        <p className="mt-2 text-sm text-[var(--psc-muted)]">
          Tracked federal issue positions from enrolled legislation. Values range from −2 (restrictive) to +2
          (progressive).
        </p>
      </header>

      <ul className="space-y-6">
        {rows.map((row) => {
          const tpl = tplByKey.get(row.issue_key);
          const stances = Array.isArray(tpl?.stances) ? (tpl.stances as { stance_key: string; label: string }[]) : [];
          const stanceLabel =
            row.current_stance_key && stances.length
              ? stances.find((s) => s.stance_key === row.current_stance_key)?.label ?? row.current_stance_key
              : row.current_stance_key ?? "Status quo (no enrolled law)";
          const hist = Array.isArray(row.history) ? (row.history as HistoryEntry[]) : [];
          const pct = spectrumPct(row.current_policy_value ?? 0);

          return (
            <li key={row.issue_key} className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
              <h2 className="text-xl font-semibold text-[var(--psc-ink)]">
                {tpl?.display_name ?? row.issue_key}
              </h2>
              {tpl?.description ? <p className="mt-1 text-xs text-[var(--psc-muted)]">{tpl.description}</p> : null}

              <div className="mt-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                  Current position
                </p>
                <div className="relative mt-2 h-3 w-full rounded-full bg-gradient-to-r from-red-600 via-slate-300 to-blue-600">
                  <span
                    className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--psc-ink)] shadow"
                    style={{ left: `${pct}%` }}
                    title={`${row.current_policy_value ?? 0}`}
                  />
                </div>
                <p className="mt-2 text-sm font-medium text-[var(--psc-ink)]">{stanceLabel}</p>
              </div>

              {row.last_changed_at && row.last_changed_by_bill_id ? (
                <p className="mt-3 text-xs text-[var(--psc-muted)]">
                  Last changed{" "}
                  <Link href={`/bill/${row.last_changed_by_bill_id}`} className="font-semibold text-[var(--psc-accent)] underline">
                    (see bill)
                  </Link>{" "}
                  on {new Date(row.last_changed_at).toLocaleString()}
                </p>
              ) : (
                <p className="mt-3 text-xs text-[var(--psc-muted)]">No enrolled change yet for this issue.</p>
              )}

              {hist.length > 0 ? (
                <details className="mt-4 text-xs">
                  <summary className="cursor-pointer font-semibold text-[var(--psc-accent)]">History</summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-[var(--psc-muted)]">
                    {[...hist].reverse().map((h, i) => (
                      <li key={`${h.bill_id}-${i}`}>
                        {h.bill_title ? (
                          <Link href={`/bill/${h.bill_id}`} className="underline">
                            {h.bill_title}
                          </Link>
                        ) : null}{" "}
                        · {h.stance_key} · {h.date ? new Date(String(h.date)).toLocaleString() : ""}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
