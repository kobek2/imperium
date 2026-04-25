import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Hist = { delta?: number }[];

function spark(deltas: Hist): string {
  const parts = deltas.map((h) => (Number(h.delta) >= 0 ? "▲" : "▼"));
  return parts.join(" ") || "—";
}

export default async function LeaderboardPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) redirect("/");
  if (!user) redirect("/login");

  const { data: rows, error } = await supabase
    .from("profiles")
    .select("id, character_name, party, office_role, approval_rating, approval_history, home_district_code")
    .order("approval_rating", { ascending: false, nullsFirst: false })
    .limit(80);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-amber-900">
        Leaderboard unavailable. {error.message}
      </div>
    );
  }

  const list = (rows ?? []) as Array<{
    id: string;
    character_name: string | null;
    party: string | null;
    office_role: string | null;
    approval_rating: number | null;
    approval_history: unknown;
    home_district_code: string | null;
  }>;

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-6">
      <header>
        <h1 className="text-3xl font-semibold text-[var(--psc-ink)]">Approval leaderboard</h1>
        <p className="mt-2 text-sm text-[var(--psc-muted)]">
          Public political approval (0–100) from whip alignment, floor-vote participation, bill outcomes, and year-end participation balancing.
        </p>
        <p className="mt-1 text-xs text-[var(--psc-muted)]">
          In-line with whip guidance: +2 · out-of-line: -3 · cast vote: +1 · no eligible vote: -1 · winning side: +1.
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-[var(--psc-border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--psc-border)] bg-[var(--psc-panel)] text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            <tr>
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Member</th>
              <th className="px-4 py-2">Party</th>
              <th className="px-4 py-2">Seat</th>
              <th className="px-4 py-2">Approval</th>
              <th className="px-4 py-2">Recent</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, idx) => {
              const hist = (Array.isArray(r.approval_history) ? r.approval_history : []) as Hist;
              const last5 = hist.slice(-5);
              const chamber = r.home_district_code ? "House" : "Senate";
              const rating = Math.round(Number(r.approval_rating ?? 50));
              return (
                <tr key={r.id} className="border-b border-[var(--psc-border)]">
                  <td className="px-4 py-2 text-[var(--psc-muted)]">{idx + 1}</td>
                  <td className="px-4 py-2 font-medium text-[var(--psc-ink)]">
                    <Link href={`/profile/${r.id}`} className="text-[var(--psc-accent)] hover:underline">
                      {r.character_name?.trim() || "Unnamed"}
                    </Link>
                  </td>
                  <td className="px-4 py-2 capitalize text-[var(--psc-muted)]">{r.party ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-[var(--psc-muted)]">{chamber}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-[var(--psc-border)]">
                        <div
                          className="h-full rounded-full bg-[var(--psc-accent)]"
                          style={{ width: `${rating}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs">{rating}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-[var(--psc-muted)]">{spark(last5)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
