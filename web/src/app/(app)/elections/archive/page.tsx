import Link from "next/link";
import { redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import { leadershipRoleLabel, type LeadershipRole } from "@/lib/leadership";

type ClosedElection = {
  id: string;
  office: string;
  state: string | null;
  district_code: string | null;
  winner_user_id: string | null;
  filing_opens_at: string;
  filing_closes_at: string;
  primary_closes_at: string | null;
  general_closes_at: string;
  leadership_role: string | null;
  restricted_party: string | null;
};

const OFFICE_TITLE: Record<string, string> = {
  house: "House of Representatives",
  senate: "Senate",
  president: "President",
  leadership: "Congressional leadership",
};

function partyLabel(p: string | null | undefined) {
  if (p === "democrat") return "Democratic";
  if (p === "republican") return "Republican";
  if (p === "independent") return "Independent";
  return p ?? "—";
}

function partyClass(p: string | null | undefined) {
  if (p === "democrat") return "text-blue-800";
  if (p === "republican") return "text-red-800";
  return "text-slate-700";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

export default async function ElectionsArchivePage() {
  const supabase = await tryCreateClient();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to load the archive.
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: elections } = await supabase
    .from("elections")
    .select(
      "id, office, state, district_code, winner_user_id, filing_opens_at, filing_closes_at, primary_closes_at, general_closes_at, leadership_role, restricted_party",
    )
    .eq("phase", "closed")
    .order("general_closes_at", { ascending: false });

  const rows = (elections ?? []) as ClosedElection[];
  const electionIds = rows.map((r) => r.id);
  const winnerIds = rows
    .map((r) => r.winner_user_id)
    .filter((id): id is string => Boolean(id));

  const [candidatesRes, primaryVotesRes, generalVotesRes, profilesRes] = await Promise.all([
    electionIds.length
      ? supabase
          .from("election_candidates")
          .select("id, election_id, user_id, party")
          .in("election_id", electionIds)
      : Promise.resolve({ data: [] as { id: string; election_id: string; user_id: string; party: string }[] }),
    electionIds.length
      ? supabase
          .from("primary_votes")
          .select("election_id")
          .in("election_id", electionIds)
      : Promise.resolve({ data: [] as { election_id: string }[] }),
    electionIds.length
      ? supabase
          .from("general_votes")
          .select("election_id")
          .in("election_id", electionIds)
      : Promise.resolve({ data: [] as { election_id: string }[] }),
    winnerIds.length
      ? supabase
          .from("profiles")
          .select("id, character_name, face_claim_url")
          .in("id", winnerIds)
      : Promise.resolve({ data: [] as { id: string; character_name: string | null; face_claim_url: string | null }[] }),
  ]);

  const candidatesByElection = new Map<string, { user_id: string; party: string }[]>();
  for (const c of candidatesRes.data ?? []) {
    const list = candidatesByElection.get(c.election_id) ?? [];
    list.push({ user_id: c.user_id, party: c.party });
    candidatesByElection.set(c.election_id, list);
  }

  const primaryVoteTotals = new Map<string, number>();
  for (const v of primaryVotesRes.data ?? []) {
    primaryVoteTotals.set(v.election_id, (primaryVoteTotals.get(v.election_id) ?? 0) + 1);
  }
  const generalVoteTotals = new Map<string, number>();
  for (const v of generalVotesRes.data ?? []) {
    generalVoteTotals.set(v.election_id, (generalVoteTotals.get(v.election_id) ?? 0) + 1);
  }

  const profileById = new Map(
    (profilesRes.data ?? []).map((p) => [p.id, p]),
  );

  const byOffice = new Map<string, ClosedElection[]>();
  for (const row of rows) {
    const key = row.leadership_role ? "leadership" : row.office;
    const list = byOffice.get(key) ?? [];
    list.push(row);
    byOffice.set(key, list);
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Election archive</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--psc-muted)]">
            Closed races with certified winners, candidate rosters, and vote totals. Click any entry to
            review the full breakdown.
          </p>
        </div>
        <Link
          href="/elections"
          className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)] hover:border-[var(--psc-accent)]"
        >
          ← Active elections
        </Link>
      </header>

      {!rows.length ? (
        <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <p className="text-sm text-[var(--psc-muted)]">
            No closed elections yet. Once a race finishes it will show up here with stats.
          </p>
        </section>
      ) : (
        <div className="space-y-10">
          {(["house", "senate", "president", "leadership"] as const).map((officeKey) => {
            const list = byOffice.get(officeKey) ?? [];
            if (!list.length) return null;
            return (
              <section key={officeKey} className="space-y-3">
                <header className="flex items-baseline justify-between border-b border-[var(--psc-border)] pb-2">
                  <h2 className="text-lg font-semibold text-[var(--psc-ink)]">
                    {OFFICE_TITLE[officeKey]}
                  </h2>
                  <span className="text-xs text-[var(--psc-muted)]">
                    {list.length} closed
                  </span>
                </header>
                <ul className="grid gap-3 md:grid-cols-2">
                  {list.map((e) => {
                    const winnerProfile = e.winner_user_id
                      ? profileById.get(e.winner_user_id)
                      : undefined;
                    const winnerParty = e.winner_user_id
                      ? (candidatesByElection.get(e.id) ?? []).find(
                          (c) => c.user_id === e.winner_user_id,
                        )?.party ?? null
                      : null;
                    const seatLabel = e.leadership_role
                      ? `${leadershipRoleLabel(e.leadership_role as LeadershipRole)}${
                          e.restricted_party ? ` · ${e.restricted_party} caucus` : ""
                        }`
                      : (e.district_code ?? e.state ?? "Nationwide");
                    const candidateCount =
                      (candidatesByElection.get(e.id) ?? []).length;
                    const primaryVotes = primaryVoteTotals.get(e.id) ?? 0;
                    const generalVotes = generalVoteTotals.get(e.id) ?? 0;

                    return (
                      <li
                        key={e.id}
                        className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4"
                      >
                        <Link
                          href={`/elections/${e.id}`}
                          className="block space-y-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-[var(--psc-ink)]">{seatLabel}</p>
                            <span className="text-xs text-[var(--psc-muted)]">
                              {formatDate(e.general_closes_at)}
                            </span>
                          </div>
                          {winnerProfile ? (
                            <div className="rounded bg-emerald-50 p-2 text-sm">
                              <span className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                                Winner
                              </span>
                              <p className="mt-0.5">
                                <span className="font-semibold text-[var(--psc-ink)]">
                                  {winnerProfile.character_name ?? "—"}
                                </span>{" "}
                                <span className={`text-xs ${partyClass(winnerParty)}`}>
                                  ({partyLabel(winnerParty)})
                                </span>
                              </p>
                            </div>
                          ) : (
                            <p className="rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-2 text-xs text-[var(--psc-muted)]">
                              Closed without a certified winner.
                            </p>
                          )}
                          <dl className="grid grid-cols-3 gap-2 text-xs">
                            <Stat label="Candidates" value={candidateCount} />
                            <Stat label="Primary votes" value={primaryVotes} />
                            <Stat label="General votes" value={generalVotes} />
                          </dl>
                          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-accent)]">
                            View details →
                          </p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 px-2 py-1.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
        {label}
      </dt>
      <dd className="font-mono text-sm text-[var(--psc-ink)]">{value}</dd>
    </div>
  );
}
