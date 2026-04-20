import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import { PartyLeadershipForms } from "./party-leadership-forms";

const VALID = new Set(["democrat", "republican"]);

type AnalyticsRow = {
  member_count?: number;
  aggregate_member_wallet_usd?: number;
  treasury_balance_usd?: number;
  national_board_seats_filled?: number;
  treasury_transferred_to_member_wallets_usd?: number;
  treasury_historic_election_grants_usd?: number;
  vacant_officer_slots?: number;
  leadership_cycle_phase?: string;
  leadership_candidate_rows?: number;
};

export default async function PartyLeadershipDashboardPage({ params }: { params: Promise<{ party: string }> }) {
  const { party: raw } = await params;
  const partyKey = raw.toLowerCase();
  if (!VALID.has(partyKey)) notFound();

  const supabase = await tryCreateClient();
  if (!supabase) redirect("/");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: officers }, { data: boardRows }, { data: org }, { data: members }, { data: proposals }, { data: viewerProfile }] =
    await Promise.all([
      supabase.from("party_officers").select("office, user_id").eq("party_key", partyKey),
      supabase.from("party_national_board_members").select("user_id, appointed_at").eq("party_key", partyKey),
      supabase
        .from("party_organizations")
        .select(
          "governing_charter_md, charter_ratified_at, treasury_balance, leadership_phase, leadership_filing_ends_at, leadership_voting_ends_at",
        )
        .eq("party_key", partyKey)
        .maybeSingle(),
      supabase.from("profiles").select("id, character_name").eq("party", partyKey).order("character_name", { ascending: true }),
      supabase
        .from("party_rule_proposals")
        .select("id, kind, title, body_md, status, proposed_by, created_at, decided_at")
        .eq("party_key", partyKey)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase.from("profiles").select("party").eq("id", user.id).maybeSingle(),
    ]);

  const viewerParty = (viewerProfile?.party as string | null | undefined) ?? null;
  if (viewerParty !== partyKey) redirect(`/parties/${partyKey}`);

  const officerSet = new Set(
    (officers ?? [])
      .filter((o) => o.user_id === user.id && ["chair", "vice_chair", "treasurer"].includes(String(o.office)))
      .map((o) => String(o.office)),
  );
  const isOfficer = officerSet.size > 0;
  const isChair = (officers ?? []).some((o) => o.office === "chair" && o.user_id === user.id);
  const boardIds = new Set((boardRows ?? []).map((b) => b.user_id as string));
  const isBoardMember = boardIds.has(user.id);
  if (!isOfficer && !isBoardMember) redirect(`/parties/${partyKey}`);

  let analytics: AnalyticsRow | null = null;
  if (isOfficer) {
    const { data: a, error } = await supabase.rpc("party_leadership_analytics", { p_party: partyKey });
    if (!error && a && typeof a === "object") analytics = a as AnalyticsRow;
  }

  const boardUserIds = [...boardIds];
  const nameById = new Map<string, string>();
  for (const m of members ?? []) nameById.set(m.id as string, String((m as { character_name: string }).character_name ?? ""));
  const boardList =
    boardUserIds.length > 0
      ? boardUserIds.map((id) => ({ user_id: id, character_name: nameById.get(id) ?? "" }))
      : [];

  const openProposal = (proposals ?? []).find((p) => (p as { status: string }).status === "open") as
    | { id: string; kind: string; title: string; body_md: string; status: string }
    | undefined;

  let yesVotes = 0;
  let noVotes = 0;
  if (openProposal) {
    const { data: vrows } = await supabase.from("party_rule_votes").select("yes").eq("proposal_id", openProposal.id);
    for (const v of vrows ?? []) {
      if ((v as { yes: boolean }).yes) yesVotes += 1;
      else noVotes += 1;
    }
  }

  const partyTitle =
    partyKey === "democrat" ? "Democratic Party" : partyKey === "republican" ? "Republican Party" : "Party";
  const boardLabel =
    partyKey === "democrat" ? "DNC national committee board" : "RNC national committee board";

  const membersForForms = (members ?? []).map((m) => ({
    id: m.id as string,
    character_name: String((m as { character_name: string }).character_name ?? ""),
  }));

  const charterMd = (org?.governing_charter_md as string | null) ?? null;
  const charterAt = (org?.charter_ratified_at as string | null) ?? null;

  return (
    <div className="space-y-10">
      <nav className="flex flex-wrap gap-4 text-sm">
        <Link href={`/parties/${partyKey}`} className="font-semibold text-[var(--psc-accent)] underline">
          ← {partyTitle} room
        </Link>
        <Link href="/parties" className="text-[var(--psc-muted)] underline">
          All parties
        </Link>
      </nav>

      <header>
        <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Leadership dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--psc-muted)]">
          Internal tools for elected officers and the national committee board. Analytics below are visible only to the
          chair, vice chair, and treasurer.
        </p>
        <p className="mt-2 text-xs text-[var(--psc-muted)]">
          Leadership cycle:{" "}
          <span className="font-semibold capitalize text-[var(--psc-ink)]">
            {(org?.leadership_phase as string | null) ?? "idle"}
          </span>
        </p>
      </header>

      {isOfficer && analytics ? (
        <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Party analytics</h2>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Aggregates and treasury flows for planning; not shown on the public party room.
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Affiliated members</dt>
              <dd className="mt-1 font-mono text-lg text-[var(--psc-ink)]">{analytics.member_count ?? "—"}</dd>
            </div>
            <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                Combined member wallet balances
              </dt>
              <dd className="mt-1 font-mono text-lg text-[var(--psc-ink)]">
                ${Number(analytics.aggregate_member_wallet_usd ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </dd>
            </div>
            <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Party treasury</dt>
              <dd className="mt-1 font-mono text-lg text-[var(--psc-ink)]">
                ${Number(analytics.treasury_balance_usd ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </dd>
            </div>
            <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Board seats filled</dt>
              <dd className="mt-1 font-mono text-lg text-[var(--psc-ink)]">{analytics.national_board_seats_filled ?? "—"}</dd>
            </div>
            <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                Treasury sent to member wallets (ledger)
              </dt>
              <dd className="mt-1 font-mono text-lg text-[var(--psc-ink)]">
                $
                {Number(analytics.treasury_transferred_to_member_wallets_usd ?? 0).toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
              </dd>
            </div>
            <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                Historic treasury election grants
              </dt>
              <dd className="mt-1 font-mono text-lg text-[var(--psc-ink)]">
                ${Number(analytics.treasury_historic_election_grants_usd ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </dd>
            </div>
            <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Vacant officer roles</dt>
              <dd className="mt-1 font-mono text-lg text-[var(--psc-ink)]">{analytics.vacant_officer_slots ?? "—"}</dd>
            </div>
            <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Leadership cycle phase</dt>
              <dd className="mt-1 capitalize text-[var(--psc-ink)]">{String(analytics.leadership_cycle_phase ?? "—")}</dd>
            </div>
            <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Leadership candidacy rows</dt>
              <dd className="mt-1 font-mono text-lg text-[var(--psc-ink)]">{analytics.leadership_candidate_rows ?? "—"}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Active charter</h2>
        {charterMd ? (
          <>
            {charterAt ? (
              <p className="mt-1 text-xs text-[var(--psc-muted)]">
                Last ratified or amended (server time): {new Date(charterAt).toLocaleString()}
              </p>
            ) : null}
            <pre className="mt-4 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-4 text-xs leading-relaxed text-[var(--psc-ink)]">
              {charterMd}
            </pre>
          </>
        ) : (
          <p className="mt-2 text-sm text-[var(--psc-muted)]">
            No charter is on file yet. The chair can open a vote to ratify the boilerplate once board members are seated.
          </p>
        )}
      </section>

      <PartyLeadershipForms
        partyKey={partyKey}
        boardLabel={boardLabel}
        isChair={isChair}
        canProposeRules={isChair || isBoardMember}
        isBoardVoter={isBoardMember}
        members={membersForForms}
        boardRows={boardList}
        openProposal={openProposal ?? null}
        boardSize={boardList.length}
        yesVotes={yesVotes}
        noVotes={noVotes}
      />

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Recent proposals</h2>
        {(proposals ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-[var(--psc-muted)]">No proposals yet.</p>
        ) : (
          <ul className="mt-4 space-y-3 text-sm">
            {(proposals ?? []).map((p) => {
              const row = p as {
                id: string;
                kind: string;
                title: string;
                status: string;
                created_at: string;
                decided_at: string | null;
              };
              return (
                <li key={row.id} className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2">
                  <span className="font-semibold text-[var(--psc-ink)]">{row.title}</span>
                  <span className="ml-2 text-xs text-[var(--psc-muted)]">
                    {row.kind} · {row.status}
                    {row.decided_at ? ` · closed ${new Date(row.decided_at).toLocaleDateString()}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
