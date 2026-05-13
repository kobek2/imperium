import { notFound, redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/server";
import { NavRouteButton } from "@/components/nav-route-button";
import { PartyLeadershipForms } from "./party-leadership-forms";
import { PartyLeadershipTreasuryFeed, type TreasuryLedgerFeedRow } from "./party-leadership-treasury-feed";

const VALID = new Set(["democrat", "republican"]);

type AnalyticsRow = {
  member_count?: number;
  aggregate_member_wallet_usd?: number;
  treasury_balance_usd?: number;
  treasury_transferred_to_member_wallets_usd?: number;
  treasury_historic_election_grants_usd?: number;
  vacant_officer_slots?: number;
  leadership_cycle_phase?: string;
  leadership_candidate_rows?: number;
  /** Sum of party salary levies (`party_collect_levy`) credited to treasury via member collects. */
  salary_levy_collected_all_time_usd?: number;
  salary_levy_collected_active_fy_usd?: number;
  salary_levy_payers_all_time?: number;
  salary_levy_member_flows?: Array<{
    user_id: string;
    character_name: string;
    withheld_total: number;
    salary_base?: number;
    received_total?: number;
    donated_total?: number;
  }>;
};

export default async function PartyLeadershipDashboardPage({ params }: { params: Promise<{ party: string }> }) {
  const { party: raw } = await params;
  const partyKey = raw.toLowerCase();
  if (!VALID.has(partyKey)) notFound();

  const { supabase, user } = await getServerAuth();
  if (!supabase) redirect("/");

  if (!user) redirect("/login");

  const [{ data: officers }, { data: org }, { data: viewerProfile }] = await Promise.all([
    supabase.from("party_officers").select("office, user_id").eq("party_key", partyKey),
    supabase
      .from("party_organizations")
      .select(
        "governing_charter_md, charter_ratified_at, treasury_balance, member_collect_levy_rate, leadership_phase, leadership_filing_ends_at, leadership_voting_ends_at",
      )
      .eq("party_key", partyKey)
      .maybeSingle(),
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
  if (!isOfficer) redirect(`/parties/${partyKey}`);

  const { data: a, error } = await supabase.rpc("party_leadership_analytics", { p_party: partyKey });
  const analytics: AnalyticsRow | null = !error && a && typeof a === "object" ? (a as AnalyticsRow) : null;

  const treasuryKinds = ["party_treasury_in", "party_collect_levy", "party_deposit"] as const;
  const { data: rawTreasuryLedger } = await supabase
    .from("economy_ledger")
    .select("id, created_at, wallet_user_id, delta, kind, detail")
    .in("kind", [...treasuryKinds])
    .contains("detail", { party: partyKey })
    .order("created_at", { ascending: false })
    .limit(50);

  const treasuryRows: TreasuryLedgerFeedRow[] = (rawTreasuryLedger ?? []).map((r) => ({
    id: String(r.id),
    created_at: String(r.created_at),
    wallet_user_id: String(r.wallet_user_id),
    delta: Number(r.delta),
    kind: String(r.kind),
    detail: r.detail && typeof r.detail === "object" && !Array.isArray(r.detail) ? (r.detail as Record<string, unknown>) : null,
  }));

  const treasuryNameIds = new Set<string>();
  for (const row of treasuryRows) {
    treasuryNameIds.add(row.wallet_user_id);
    const fo = row.detail?.from_officer;
    if (typeof fo === "string" && fo.length > 0) treasuryNameIds.add(fo);
  }

  const { data: treasuryProfiles } =
    treasuryNameIds.size > 0
      ? await supabase.from("profiles").select("id, character_name, discord_username").in("id", [...treasuryNameIds])
      : { data: [] as { id: string; character_name: string | null; discord_username: string | null }[] };

  const treasuryNameById = new Map(
    (treasuryProfiles ?? []).map((p) => [
      p.id,
      { character_name: p.character_name ?? null, discord_username: p.discord_username ?? null },
    ] as const),
  );

  const partyTitle =
    partyKey === "democrat" ? "Democratic Party" : partyKey === "republican" ? "Republican Party" : "Party";

  const charterMd = (org?.governing_charter_md as string | null) ?? null;
  const charterAt = (org?.charter_ratified_at as string | null) ?? null;

  const levyAnalytics = analytics
    ? {
        memberFlows: Array.isArray(analytics.salary_levy_member_flows) ? analytics.salary_levy_member_flows : [],
      }
    : null;

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[var(--psc-ink)]">Leadership dashboard</h1>
        <div className="flex flex-wrap items-center gap-2">
          <NavRouteButton href={`/parties/${partyKey}`}>{partyTitle} room</NavRouteButton>
          <NavRouteButton href="/parties">All parties</NavRouteButton>
        </div>
      </header>

      {analytics ? (
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
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Recent treasury movements</h2>
        <p className="mt-1 text-xs text-[var(--psc-muted)]">
          Ledger entries for this party: chair or treasurer transfers to members, automatic salary levies on collect, and
          voluntary member deposits into the treasury.
        </p>
        <PartyLeadershipTreasuryFeed rows={treasuryRows} nameById={treasuryNameById} />
      </section>

      {charterMd ? (
        <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Active charter</h2>
          {charterAt ? (
            <p className="mt-1 text-xs text-[var(--psc-muted)]">
              Last ratified or amended (server time): {new Date(charterAt).toLocaleString()}
            </p>
          ) : null}
          <pre className="mt-4 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-4 text-xs leading-relaxed text-[var(--psc-ink)]">
            {charterMd}
          </pre>
        </section>
      ) : null}

      <PartyLeadershipForms
        partyKey={partyKey}
        isChair={isChair}
        memberCollectLevyRate={Number((org as { member_collect_levy_rate?: number } | null)?.member_collect_levy_rate ?? 0)}
        levyAnalytics={levyAnalytics}
      />
    </div>
  );
}
