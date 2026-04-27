import Link from "next/link";
import { redirect } from "next/navigation";
import { profilePath } from "@/components/profile-card";
import { getServerAuth } from "@/lib/supabase/server";

type PresidentHistoryRow = {
  userId: string;
  name: string;
  party: string;
  state: string;
  wins: number;
  firstWinAt: string | null;
  lastWinAt: string | null;
  winYears: number[];
  lawsAuthored: number;
  isCurrentPresident: boolean;
};

function partyLabel(p: string | null | undefined) {
  const v = String(p ?? "").toLowerCase();
  if (v === "democrat") return "Democratic";
  if (v === "republican") return "Republican";
  if (v === "independent") return "Independent";
  return "Unaffiliated";
}

function stateLabel(residenceState: string | null | undefined, district: string | null | undefined) {
  const s = String(residenceState ?? "").trim().toUpperCase();
  if (s) return s;
  const d = String(district ?? "").trim().toUpperCase();
  if (d.length >= 2) return d.slice(0, 2);
  return "—";
}

function dateLabel(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function yearFromIso(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCFullYear();
}

export default async function HistoryPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to load the presidential archive.
      </div>
    );
  }
  if (!user) redirect("/login");

  const { data: presidentialElections } = await supabase
    .from("elections")
    .select("winner_user_id, general_closes_at, created_at")
    .eq("office", "president")
    .eq("phase", "closed")
    .not("winner_user_id", "is", null)
    .order("general_closes_at", { ascending: true });

  const rows = (presidentialElections ?? []) as Array<{
    winner_user_id: string | null;
    general_closes_at: string | null;
    created_at: string;
  }>;

  const winnerIds = [...new Set(rows.map((r) => r.winner_user_id).filter(Boolean) as string[])];

  const [profilesRes, lawsRes, grantsRes] = await Promise.all([
    winnerIds.length
      ? supabase
          .from("profiles")
          .select("id, character_name, party, residence_state, home_district_code")
          .in("id", winnerIds)
      : Promise.resolve({ data: [] as never[] }),
    winnerIds.length
      ? supabase.from("bills").select("author_id").eq("status", "law").in("author_id", winnerIds)
      : Promise.resolve({ data: [] as never[] }),
    winnerIds.length
      ? supabase
          .from("government_role_grants")
          .select("user_id, role_key")
          .in("user_id", winnerIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const profileById = new Map(
    ((profilesRes.data ?? []) as Array<{
      id: string;
      character_name: string | null;
      party: string | null;
      residence_state: string | null;
      home_district_code: string | null;
    }>).map((p) => [p.id, p] as const),
  );

  const lawsByAuthor = new Map<string, number>();
  for (const row of (lawsRes.data ?? []) as Array<{ author_id: string }>) {
    lawsByAuthor.set(row.author_id, (lawsByAuthor.get(row.author_id) ?? 0) + 1);
  }

  const presidentGrantHolders = new Set(
    ((grantsRes.data ?? []) as Array<{ user_id: string; role_key: string }>)
      .filter((g) => g.role_key === "president")
      .map((g) => g.user_id),
  );

  const historyByUser = new Map<string, PresidentHistoryRow>();
  for (const r of rows) {
    if (!r.winner_user_id) continue;
    const uid = r.winner_user_id;
    const p = profileById.get(uid);
    const at = r.general_closes_at ?? r.created_at;
    const y = yearFromIso(at);
    const existing = historyByUser.get(uid);
    if (!existing) {
      historyByUser.set(uid, {
        userId: uid,
        name: p?.character_name?.trim() || `User ${uid.slice(0, 8)}`,
        party: partyLabel(p?.party),
        state: stateLabel(p?.residence_state, p?.home_district_code),
        wins: 1,
        firstWinAt: at,
        lastWinAt: at,
        winYears: y ? [y] : [],
        lawsAuthored: lawsByAuthor.get(uid) ?? 0,
        isCurrentPresident: presidentGrantHolders.has(uid),
      });
      continue;
    }
    existing.wins += 1;
    existing.lastWinAt = at;
    if (y && !existing.winYears.includes(y)) existing.winYears.push(y);
  }

  const history = [...historyByUser.values()].sort((a, b) => {
    const ta = a.firstWinAt ? new Date(a.firstWinAt).getTime() : 0;
    const tb = b.firstWinAt ? new Date(b.firstWinAt).getTime() : 0;
    return ta - tb;
  });

  const hallOfFame = [...history].sort((a, b) => {
    const scoreA = a.wins * 100 + a.lawsAuthored * 4 + (a.isCurrentPresident ? 20 : 0);
    const scoreB = b.wins * 100 + b.lawsAuthored * 4 + (b.isCurrentPresident ? 20 : 0);
    return scoreB - scoreA;
  });

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-7 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--psc-muted)]">Imperium Archives</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--psc-ink)]">Presidential History</h1>
        <p className="mt-3 max-w-3xl text-sm text-[var(--psc-muted)]">
          A running archive of Imperium presidential winners and a hall of fame snapshot. This page focuses on high-level
          career impact: election victories, tenure timeline, and laws signed from each leader&apos;s broader political arc.
        </p>
        <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
          <Link href="/elections" className="rounded border border-[var(--psc-border)] bg-white px-3 py-2 text-[var(--psc-ink)]">
            Elections
          </Link>
          <Link href="/directory" className="rounded border border-[var(--psc-border)] bg-white px-3 py-2 text-[var(--psc-ink)]">
            Directory
          </Link>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-xl font-semibold text-[var(--psc-ink)]">Hall of Fame</h2>
        <p className="text-sm text-[var(--psc-muted)]">
          Ranking uses presidential wins as the primary factor, then enacted laws and active presidency.
        </p>
        {hallOfFame.length === 0 ? (
          <p className="text-sm text-[var(--psc-muted)]">No closed presidential races yet.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {hallOfFame.slice(0, 6).map((p, i) => (
              <article key={p.userId} className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--psc-muted)]">Rank #{i + 1}</p>
                <h3 className="mt-1 text-lg font-semibold text-[var(--psc-ink)]">{p.name}</h3>
                <p className="mt-1 text-xs text-[var(--psc-muted)]">
                  {p.party} · {p.state}
                </p>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded border border-[var(--psc-border)] bg-white px-1 py-2">
                    <dt className="text-[10px] uppercase text-[var(--psc-muted)]">Wins</dt>
                    <dd className="font-mono text-sm font-semibold text-[var(--psc-ink)]">{p.wins}</dd>
                  </div>
                  <div className="rounded border border-[var(--psc-border)] bg-white px-1 py-2">
                    <dt className="text-[10px] uppercase text-[var(--psc-muted)]">Laws</dt>
                    <dd className="font-mono text-sm font-semibold text-[var(--psc-ink)]">{p.lawsAuthored}</dd>
                  </div>
                  <div className="rounded border border-[var(--psc-border)] bg-white px-1 py-2">
                    <dt className="text-[10px] uppercase text-[var(--psc-muted)]">Latest</dt>
                    <dd className="font-mono text-sm font-semibold text-[var(--psc-ink)]">
                      {p.winYears.length ? Math.max(...p.winYears) : "—"}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-[var(--psc-muted)]">
                  {p.isCurrentPresident ? "Current acting President" : "Former President"}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-xl font-semibold text-[var(--psc-ink)]">Presidential Timeline</h2>
        {history.length === 0 ? (
          <p className="text-sm text-[var(--psc-muted)]">No closed presidential races yet.</p>
        ) : (
          <ol className="space-y-3">
            {history.map((p) => (
              <li key={p.userId} className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--psc-ink)]">{p.name}</h3>
                    <p className="text-xs text-[var(--psc-muted)]">
                      {p.party} · {p.state}
                    </p>
                  </div>
                  <div className="text-right text-xs text-[var(--psc-muted)]">
                    <p>First won: {dateLabel(p.firstWinAt)}</p>
                    <p>Last won: {dateLabel(p.lastWinAt)}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded border border-[var(--psc-border)] bg-white px-2 py-1">
                    Wins: <strong className="text-[var(--psc-ink)]">{p.wins}</strong>
                  </span>
                  <span className="rounded border border-[var(--psc-border)] bg-white px-2 py-1">
                    Law milestones: <strong className="text-[var(--psc-ink)]">{p.lawsAuthored}</strong>
                  </span>
                  <span className="rounded border border-[var(--psc-border)] bg-white px-2 py-1">
                    Election years: <strong className="text-[var(--psc-ink)]">{p.winYears.join(", ") || "—"}</strong>
                  </span>
                </div>
                <div className="mt-3">
                  <Link
                    href={profilePath(p.userId) ?? "/directory"}
                    className="text-xs font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline"
                  >
                    Open profile →
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
