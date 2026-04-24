import { redirect } from "next/navigation";
import { NavRouteButton } from "@/components/nav-route-button";
import { getServerAuth } from "@/lib/supabase/server";

export default async function EconomyLeaderboardPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) redirect("/");

  if (!user) redirect("/login");

  const { data: rows, error } = await supabase
    .from("economy_wallets")
    .select("user_id, balance")
    .order("balance", { ascending: false })
    .limit(50);

  if (error) {
    const hintSchema =
      error.message.includes("schema cache") ||
      error.message.includes("economy_wallets") ||
      error.code === "PGRST205";
    return (
      <div className="space-y-4 border border-rose-700 bg-rose-50 p-6 text-sm text-rose-900">
        <p className="font-semibold">Could not load leaderboard</p>
        <p className="font-mono text-xs text-rose-950/90">{error.message}</p>
        {hintSchema ? (
          <div className="border-t border-rose-200 pt-4 text-rose-950/90">
            <p>
              PostgREST does not see <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">public.economy_wallets</code> yet.
              That table (and the rest of the economy module) is created in{" "}
              <code className="whitespace-pre-wrap rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">
                supabase/migrations/20260438000000_economy_and_party_directory.sql
              </code>
              , with follow-ups such as{" "}
              <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">20260439000000_…</code> and later
              files in the same folder.
            </p>
            <ol className="mt-3 list-decimal space-y-2 pl-5">
              <li>
                From the Imperium repo root, with the Supabase CLI linked to this project, run{" "}
                <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">supabase db push</code>, or paste
                the migration SQL into the Supabase SQL editor and execute it in order.
              </li>
              <li>
                If the table already exists in Postgres but this error persists, reload the API schema cache in the
                Supabase dashboard (Project settings → API → reload schema, or restart the project).
              </li>
            </ol>
          </div>
        ) : null}
      </div>
    );
  }

  const ids = (rows ?? []).map((r) => r.user_id as string);
  const { data: profiles } =
    ids.length > 0
      ? await supabase.from("profiles").select("id, character_name, party").in("id", ids)
      : { data: [] as const };

  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Economy leaderboard</h1>
          <p className="mt-1 text-sm text-[var(--psc-muted)]">Top wallet balances (public to members).</p>
        </div>
        <NavRouteButton href="/economy">Economy hub</NavRouteButton>
      </header>

      <ol className="divide-y divide-[var(--psc-border)] rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]">
        {(rows ?? []).map((r, i) => {
          const p = nameById.get(r.user_id as string);
          const label = p?.character_name ?? (r.user_id as string).slice(0, 8);
          return (
            <li key={r.user_id as string} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="font-mono text-xs text-[var(--psc-muted)]">{i + 1}.</span>
              <span className="flex-1 font-semibold text-[var(--psc-ink)]">{label}</span>
              <span className="font-mono tabular-nums text-[var(--psc-ink)]">
                ${Number(r.balance).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
