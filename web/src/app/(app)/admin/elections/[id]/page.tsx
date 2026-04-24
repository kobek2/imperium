import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { getServerAuth } from "@/lib/supabase/server";
import { requireStaffPageAny } from "@/lib/staff-access";
import { OpenSeatFilingForm } from "@/components/open-seat-filing-form";
import { FormSubmitButton } from "@/components/form-submit-button";
import { SubmitButton } from "@/components/submit-button";
import {
  deleteElection,
  endPrimarySelectWinners,
  finalizePresident,
  setCandidateCampaignPoints,
  setElectionPhase,
  updateElectionPrimaryBallot,
} from "@/app/actions/elections";
import {
  isLeadershipRole,
  leadershipRoleLabel,
  type LeadershipRole,
} from "@/lib/leadership";

type CandidateRow = {
  id: string;
  user_id: string;
  party: string;
  campaign_points_total: number | null;
  primary_winner: boolean | null;
  created_at?: string | null;
};

type ProfileRow = {
  id: string;
  character_name: string | null;
  face_claim_url: string | null;
  residence_state: string | null;
  home_district_code: string | null;
  party: string | null;
};

function partyLabel(p: string) {
  if (p === "democrat") return "Democratic";
  if (p === "republican") return "Republican";
  if (p === "independent") return "Independent";
  return p;
}

function partyClass(p: string) {
  if (p === "democrat") return "text-blue-800";
  if (p === "republican") return "text-red-800";
  return "text-slate-700";
}

function faceUrlOk(url: string | null | undefined) {
  const u = (url ?? "").trim();
  return u.startsWith("http://") || u.startsWith("https://");
}

function initials(name: string | null, fallback: string) {
  const s = (name ?? "").trim();
  if (!s) return fallback.slice(0, 2).toUpperCase();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function phasePillClass(phase: string) {
  switch (phase) {
    case "filing":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "primary":
      return "bg-blue-100 text-blue-900 border-blue-200";
    case "general":
      return "bg-violet-100 text-violet-900 border-violet-200";
    case "closed":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
    default:
      return "bg-slate-100 text-slate-900 border-slate-200";
  }
}

export default async function AdminElectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaffPageAny(["elections", "simulation"]);

  const { id } = await params;
  const { supabase } = await getServerAuth();
  if (!supabase) redirect("/");

  await runElectionPhaseSchedule(supabase);

  const { data: election } = await supabase
    .from("elections")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!election) notFound();

  let jurisdictionPlayerCount: number | undefined;
  if (
    election.phase === "filing" &&
    !election.filing_window_started_at &&
    !isLeadershipRole(election.leadership_role)
  ) {
    if (election.office === "house" && election.district_code) {
      const d = String(election.district_code).trim().toUpperCase();
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("home_district_code", d);
      jurisdictionPlayerCount = count ?? 0;
    } else if (election.office === "senate" && election.state) {
      const st = String(election.state).trim().toUpperCase();
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("residence_state", st);
      jurisdictionPlayerCount = count ?? 0;
    } else if (election.office === "president") {
      const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true });
      jurisdictionPlayerCount = count ?? 0;
    }
  }

  const { data: candidates } = await supabase
    .from("election_candidates")
    .select("id, user_id, party, campaign_points_total, primary_winner, created_at")
    .eq("election_id", id)
    .order("id", { ascending: true });

  const candList = (candidates ?? []) as CandidateRow[];
  const userIds = candList.map((c) => c.user_id);

  let profiles: ProfileRow[] = [];
  if (userIds.length) {
    const { data: p } = await supabase
      .from("profiles")
      .select("id, character_name, face_claim_url, residence_state, home_district_code, party")
      .in("id", userIds);
    profiles = (p ?? []) as ProfileRow[];
  }
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  const candIds = candList.map((c) => c.id);

  const primaryCountsByCandidate = new Map<string, number>();
  const generalCountsByCandidate = new Map<string, number>();
  const speechCountsByCandidate = new Map<string, number>();
  const rallyCountsByCandidate = new Map<string, number>();
  const endorsementCountsByCandidate = new Map<string, number>();
  const endorsementPointsByCandidate = new Map<string, number>();

  if (candIds.length) {
    const [
      primaryVotes,
      generalVotes,
      speeches,
      rallies,
      endorsements,
    ] = await Promise.all([
      supabase
        .from("primary_votes")
        .select("candidate_id")
        .eq("election_id", id),
      supabase
        .from("general_votes")
        .select("candidate_id")
        .eq("election_id", id),
      supabase
        .from("campaign_speeches")
        .select("candidate_id")
        .eq("election_id", id),
      supabase
        .from("campaign_rallies")
        .select("candidate_id")
        .eq("election_id", id),
      supabase
        .from("campaign_endorsements")
        .select("candidate_id, points")
        .eq("election_id", id),
    ]);

    for (const v of primaryVotes.data ?? []) {
      const key = v.candidate_id as string;
      primaryCountsByCandidate.set(key, (primaryCountsByCandidate.get(key) ?? 0) + 1);
    }
    for (const v of generalVotes.data ?? []) {
      const key = v.candidate_id as string;
      generalCountsByCandidate.set(key, (generalCountsByCandidate.get(key) ?? 0) + 1);
    }
    for (const s of speeches.data ?? []) {
      const key = s.candidate_id as string;
      speechCountsByCandidate.set(key, (speechCountsByCandidate.get(key) ?? 0) + 1);
    }
    for (const r of rallies.data ?? []) {
      const key = r.candidate_id as string;
      rallyCountsByCandidate.set(key, (rallyCountsByCandidate.get(key) ?? 0) + 1);
    }
    for (const e of endorsements.data ?? []) {
      const key = e.candidate_id as string;
      endorsementCountsByCandidate.set(key, (endorsementCountsByCandidate.get(key) ?? 0) + 1);
      endorsementPointsByCandidate.set(
        key,
        (endorsementPointsByCandidate.get(key) ?? 0) + Number(e.points ?? 0),
      );
    }
  }

  const totalPrimaryVotes = Array.from(primaryCountsByCandidate.values()).reduce(
    (s, n) => s + n,
    0,
  );
  const totalGeneralVotes = Array.from(generalCountsByCandidate.values()).reduce(
    (s, n) => s + n,
    0,
  );

  const winnerProfile = election.winner_user_id
    ? profileById.get(election.winner_user_id as string)
    : undefined;

  const seatLabel = election.leadership_role
    ? `${leadershipRoleLabel(election.leadership_role as LeadershipRole)}${
        election.restricted_party ? ` · ${election.restricted_party} caucus` : ""
      }`
    : (election.district_code ?? election.state ?? "Nationwide");

  const sortedCandidates = [...candList].sort((a, b) => {
    // primary winners first, then general vote count desc, then filing order (id asc)
    const aw = a.primary_winner ? 1 : 0;
    const bw = b.primary_winner ? 1 : 0;
    if (aw !== bw) return bw - aw;
    const av = generalCountsByCandidate.get(a.id) ?? 0;
    const bv = generalCountsByCandidate.get(b.id) ?? 0;
    if (av !== bv) return bv - av;
    return a.id.localeCompare(b.id);
  });

  return (
    <div className="space-y-8">
      <Link
        href="/admin/elections"
        className="admin-textlink text-sm font-semibold text-[var(--psc-accent)]"
      >
        ← Elections
      </Link>

      <header className="space-y-4 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full border px-3 py-0.5 text-xs font-semibold uppercase tracking-wide ${phasePillClass(election.phase)}`}
          >
            {election.phase}
          </span>
          <span className="text-xs text-[var(--psc-muted)]">
            {candList.length} candidate{candList.length === 1 ? "" : "s"}
          </span>
          <Link
            href={`/elections/${id}`}
            className="ml-auto text-xs font-semibold text-[var(--psc-accent)] underline"
          >
            Open player view →
          </Link>
        </div>
        <div>
          <h2 className="text-2xl font-semibold">
            {election.office.toUpperCase()} · {seatLabel}
          </h2>
          {winnerProfile ? (
            <p className="mt-1 text-sm text-emerald-900">
              Certified winner:{" "}
              <strong>{winnerProfile.character_name ?? winnerProfile.id.slice(0, 8)}</strong>{" "}
              ({partyLabel(winnerProfile.party ?? "")})
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-4 text-xs sm:grid-cols-4">
          <TimelineStat
            label="Filing opens"
            value={formatDateTime(election.filing_opens_at)}
          />
          <TimelineStat
            label="Filing closes"
            value={formatDateTime(election.filing_closes_at)}
          />
          <TimelineStat
            label="Primary closes"
            value={
              isLeadershipRole(election.leadership_role)
                ? "—"
                : formatDateTime(election.primary_closes_at)
            }
          />
          <TimelineStat
            label="General closes"
            value={formatDateTime(election.general_closes_at)}
          />
        </div>
      </header>

      {election.phase === "filing" &&
      !isLeadershipRole(election.leadership_role) &&
      !election.filing_window_started_at ? (
        <section className="space-y-3 border border-amber-400 bg-amber-50 p-6 text-sm text-amber-950">
          <h3 className="font-semibold">Dormant filing template</h3>
          <p className="max-w-2xl text-xs">
            Players cannot see this race on the public elections page until you open the filing
            window. Opening assigns a fresh 24h filing, 24h primary, and 24h general schedule from now
            and vacates incumbents for this seat where applicable.
          </p>
          <OpenSeatFilingForm electionId={id} jurisdictionPlayerCount={jurisdictionPlayerCount} />
        </section>
      ) : null}

      {isLeadershipRole(election.leadership_role) ? (
        <section className="space-y-2 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 text-sm">
          <h3 className="font-semibold">Leadership race</h3>
          <p className="text-xs text-[var(--psc-muted)]">
            This race skips the primary and is decided by plain plurality of the eligible chamber.
            Campaign points and partisan lean do not apply.
          </p>
        </section>
      ) : null}

      <section
        className={`space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 ${
          isLeadershipRole(election.leadership_role) ? "hidden" : ""
        }`}
      >
        <h3 className="font-semibold">Primary ballot reach</h3>
        <p className="max-w-2xl text-xs text-[var(--psc-muted)]">
          Party-wide lets any same-party player vote. Jurisdiction-only limits voting to players whose
          Character matches this seat (except candidates voting for themselves). President is always
          party-wide.
        </p>
        {election.office === "president" ? (
          <p className="text-xs text-[var(--psc-muted)]">
            This race is presidential; primary ballots are always party-wide.
          </p>
        ) : (
          <form
            action={updateElectionPrimaryBallot}
            className="grid w-full min-w-0 gap-3 sm:max-w-lg"
          >
            <input type="hidden" name="election_id" value={id} />
            <label className="grid min-w-0 gap-1 text-xs font-semibold">
              Who may vote in the primary
              <select
                name="primary_ballot_scope"
                defaultValue={
                  election.primary_party_wide !== false ? "party_wide" : "jurisdiction_only"
                }
                className="w-full min-w-0 border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
              >
                <option value="party_wide">Party-wide (any same-party voter)</option>
                <option value="jurisdiction_only">
                  Jurisdiction only (seat residents + self)
                </option>
              </select>
            </label>
            <FormSubmitButton
              idleLabel="Save"
              pendingLabel="Saving…"
              className="justify-self-start border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase text-white"
            />
          </form>
        )}
      </section>

      <section className="space-y-4 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <div>
          <h3 className="font-semibold">Phase controls</h3>
          <p className="mt-1 max-w-2xl text-xs text-[var(--psc-muted)]">
            Phases advance on their own when a deadline passes. Override here whenever you need to push a
            race forward (or back) immediately — set a new end time so auto-advance waits for your new
            window. Moving forward picks plurality winners automatically (ties broken by earliest filer).
          </p>
        </div>

        <form
          action={setElectionPhase}
          className="grid gap-3 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        >
          <input type="hidden" name="election_id" value={id} />
          <label className="grid min-w-0 gap-1 text-xs font-semibold">
            Target phase
            <select
              name="phase"
              required
              defaultValue={election.phase}
              className="w-full min-w-0 border border-[var(--psc-border)] bg-white px-3 py-2 text-sm font-normal"
            >
              <option value="filing">Filing</option>
              <option value="primary">Primary (auto-pick per-party nominees)</option>
              <option value="general">General (auto-advance if coming from primary)</option>
              <option value="closed">Closed (finalize + certify winner)</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-xs font-semibold">
            New end time (optional)
            <input
              type="datetime-local"
              name="end_at"
              className="w-full min-w-0 border border-[var(--psc-border)] bg-white px-3 py-2 text-sm font-normal"
            />
            <span className="text-[10px] font-normal text-[var(--psc-muted)]">
              Writes to filing/primary/general closes-at depending on target phase. Leave blank to keep
              existing deadlines.
            </span>
          </label>
          <FormSubmitButton
            idleLabel="Apply"
            pendingLabel="Applying…"
            className="justify-self-start border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white sm:justify-self-end"
          />
        </form>

        <div className="grid gap-2 text-[11px] text-[var(--psc-muted)] sm:grid-cols-2">
          <p>
            <strong className="text-[var(--psc-ink)]">primary:</strong> one nominee per party from
            primary_votes plurality; solo filers or 0-vote ties default to the earliest filer.
          </p>
          <p>
            <strong className="text-[var(--psc-ink)]">closed:</strong> House/Senate use the 60/40 FEC
            score; president uses general-vote plurality. Role transitions fire automatically.
          </p>
        </div>

        {election.phase === "general" && election.office === "president" ? (
          <div className="border-t border-[var(--psc-border)] pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
              Override presidential finalize
            </p>
            <p className="mt-1 max-w-xl text-xs text-[var(--psc-muted)]">
              Closing a presidential race normally picks the general-vote leader. If you want a specific
              candidate certified instead, choose them here.
            </p>
            <form action={finalizePresident} className="mt-2 flex flex-wrap items-center gap-2">
              <input type="hidden" name="election_id" value={id} />
              <select
                name="winner_candidate_id"
                required
                className="w-full min-w-0 max-w-xs border border-[var(--psc-border)] bg-white px-2 py-2 text-xs sm:w-auto"
              >
                <option value="">Winner (candidate row)</option>
                {candList.map((c) => {
                  const prof = profileById.get(c.user_id);
                  return (
                    <option key={c.id} value={c.id}>
                      {prof?.character_name ?? c.user_id.slice(0, 8)} ({partyLabel(c.party)})
                    </option>
                  );
                })}
              </select>
              <SubmitButton
                pendingLabel="Certifying…"
                className="border border-green-900 bg-green-950 px-3 py-2 text-xs font-semibold uppercase text-white transition hover:brightness-110"
              >
                Certify this candidate
              </SubmitButton>
            </form>
          </div>
        ) : null}

        {election.phase === "primary" ? (
          <div className="border-t border-[var(--psc-border)] pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
              Quick action
            </p>
            <form action={endPrimarySelectWinners} className="mt-2">
              <input type="hidden" name="election_id" value={id} />
              <SubmitButton
                pendingLabel="Ending primary…"
                className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase text-white transition hover:brightness-110"
              >
                End primary → general + winners
              </SubmitButton>
            </form>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">
            Candidates ({candList.length})
          </h3>
          <div className="flex flex-wrap gap-4 text-xs text-[var(--psc-muted)]">
            <span>Primary votes: {totalPrimaryVotes}</span>
            <span>General votes: {totalGeneralVotes}</span>
          </div>
        </div>
        <p className="max-w-2xl text-xs text-[var(--psc-muted)]">
          Each card shows filing date, primary vote tally, general vote tally, and campaign activity pulled
          from this race. Edit FEC-style campaign totals before finalizing House or Senate races.
        </p>

        {!candList.length ? (
          <p className="rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-6 text-center text-sm text-[var(--psc-muted)]">
            No candidates have filed yet.
          </p>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {sortedCandidates.map((c) => {
              const profile = profileById.get(c.user_id);
              const name =
                profile?.character_name?.trim() || c.user_id.slice(0, 8);
              const avatarUrl = faceUrlOk(profile?.face_claim_url)
                ? profile!.face_claim_url!
                : null;
              const primaryVotes = primaryCountsByCandidate.get(c.id) ?? 0;
              const generalVotes = generalCountsByCandidate.get(c.id) ?? 0;
              const speeches = speechCountsByCandidate.get(c.id) ?? 0;
              const rallies = rallyCountsByCandidate.get(c.id) ?? 0;
              const endorsements = endorsementCountsByCandidate.get(c.id) ?? 0;
              const endorsementPts = endorsementPointsByCandidate.get(c.id) ?? 0;
              const isWinner =
                election.phase === "closed" && election.winner_user_id === c.user_id;
              const seatLine =
                profile?.home_district_code?.trim() ||
                (profile?.residence_state
                  ? profile.residence_state.toUpperCase()
                  : "—");

              return (
                <li
                  key={c.id}
                  className={`space-y-4 rounded border bg-[var(--psc-panel)] p-4 ${
                    isWinner
                      ? "border-emerald-700 ring-2 ring-emerald-200"
                      : "border-[var(--psc-border)]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Link
                      href={`/profile/${c.user_id}`}
                      className="shrink-0 outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--psc-accent)]"
                    >
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={avatarUrl}
                          alt=""
                          className="h-14 w-14 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded bg-[var(--psc-canvas)] text-sm font-semibold text-[var(--psc-ink)]">
                          {initials(profile?.character_name ?? null, c.user_id)}
                        </div>
                      )}
                    </Link>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/profile/${c.user_id}`}
                          className="truncate text-base font-semibold text-[var(--psc-ink)] hover:underline"
                        >
                          {name}
                        </Link>
                        <span
                          className={`text-xs font-semibold uppercase ${partyClass(c.party)}`}
                        >
                          {partyLabel(c.party)}
                        </span>
                        {c.primary_winner ? (
                          <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-900">
                            Primary winner
                          </span>
                        ) : null}
                        {isWinner ? (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-900">
                            Certified winner
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-[var(--psc-muted)]">
                        {seatLine} · filed {formatDateTime(c.created_at)}
                      </p>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                    <Stat label="Primary votes" value={primaryVotes} />
                    <Stat label="General votes" value={generalVotes} />
                    <Stat label="Campaign pts" value={Number(c.campaign_points_total ?? 0)} />
                    <Stat label="Speeches" value={speeches} />
                    <Stat label="Rallies" value={rallies} />
                    <Stat
                      label="Endorsements"
                      value={
                        endorsementPts > 0
                          ? `${endorsements} (${endorsementPts} pts)`
                          : endorsements
                      }
                    />
                  </dl>

                  <form
                    action={setCandidateCampaignPoints}
                    className="flex flex-wrap items-end gap-2 border-t border-[var(--psc-border)] pt-3 text-xs"
                  >
                    <input type="hidden" name="election_id" value={id} />
                    <input type="hidden" name="candidate_id" value={c.id} />
                    <label className="grid min-w-0 gap-1 font-semibold">
                      FEC campaign pts total
                      <input
                        type="number"
                        name="campaign_points_total"
                        min={0}
                        step={1}
                        defaultValue={Number(c.campaign_points_total ?? 0)}
                        className="w-36 border border-[var(--psc-border)] bg-white px-2 py-1 font-normal"
                      />
                    </label>
                    <FormSubmitButton
                      idleLabel="Save"
                      pendingLabel="Saving…"
                      className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-1 text-xs font-semibold uppercase text-white"
                    />
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <form action={deleteElection}>
          <input type="hidden" name="election_id" value={id} />
          <SubmitButton
            pendingLabel="Deleting…"
            className="text-xs font-semibold uppercase text-red-700 underline transition hover:text-red-900"
          >
            Delete election
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}

function TimelineStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-[var(--psc-ink)]">{value}</p>
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
