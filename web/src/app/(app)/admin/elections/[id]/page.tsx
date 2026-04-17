import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { tryCreateClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";
import {
  deleteElection,
  endPrimarySelectWinners,
  finalizeHouseSenateGeneral,
  finalizePresident,
  setCandidateCampaignPoints,
  setElectionPhase,
  updateElectionPrimaryBallot,
} from "@/app/actions/elections";

export default async function AdminElectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await getIsAdmin())) redirect("/");

  const { id } = await params;
  const supabase = await tryCreateClient();
  if (!supabase) redirect("/");

  await runElectionPhaseSchedule(supabase);

  const { data: election } = await supabase.from("elections").select("*").eq("id", id).maybeSingle();
  if (!election) notFound();

  const { data: candidates } = await supabase
    .from("election_candidates")
    .select("id, user_id, party, campaign_points_total, primary_winner")
    .eq("election_id", id)
    .order("id", { ascending: true });

  const candList = candidates ?? [];
  let profiles: { id: string; character_name: string | null }[] = [];
  if (candList.length) {
    const { data: p } = await supabase
      .from("profiles")
      .select("id, character_name")
      .in(
        "id",
        candList.map((c) => c.user_id),
      );
    profiles = p ?? [];
  }

  const names = Object.fromEntries(profiles.map((p) => [p.id, p.character_name]));

  return (
    <div className="space-y-8">
      <Link href="/admin/elections" className="admin-textlink text-sm font-semibold text-[var(--psc-accent)]">
        ← Elections
      </Link>

      <header>
        <p className="font-mono text-xs text-[var(--psc-muted)]">{election.phase}</p>
        <h2 className="text-2xl font-semibold">
          {election.office.toUpperCase()} · {election.district_code ?? election.state ?? "Nationwide"}
        </h2>
        <p className="mt-2 text-xs text-[var(--psc-muted)]">
          Filing {new Date(election.filing_opens_at).toLocaleString()} —{" "}
          {new Date(election.filing_closes_at).toLocaleString()} · Primary ends{" "}
          {new Date(election.primary_closes_at).toLocaleString()} · General ends{" "}
          {new Date(election.general_closes_at).toLocaleString()}
        </p>
        <Link
          href={`/elections/${id}`}
          className="admin-textlink mt-3 inline-block text-sm text-[var(--psc-accent)] underline underline-offset-2"
        >
          Open player view →
        </Link>
      </header>

      <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h3 className="font-semibold">Primary ballot reach</h3>
        <p className="mt-1 max-w-2xl text-xs text-[var(--psc-muted)]">
          <strong>Party-wide</strong> (default): any player in the same party may vote in this primary,
          including for nominees in other districts or states. <strong>Jurisdiction-only</strong>: only
          players whose Character <strong>home district</strong> (House) or <strong>residence state</strong>{" "}
          (Senate) matches this seat may vote — except candidates may always cast a ballot for{" "}
          <strong>themselves</strong> on this race. President is always party-wide.
        </p>
        {election.office === "president" ? (
          <p className="mt-2 text-xs text-[var(--psc-muted)]">This race is presidential; primary ballots are always party-wide.</p>
        ) : (
          <form action={updateElectionPrimaryBallot} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="election_id" value={id} />
            <label className="grid gap-1 font-semibold">
              Who may vote in the primary
              <select
                name="primary_ballot_scope"
                defaultValue={election.primary_party_wide !== false ? "party_wide" : "jurisdiction_only"}
                className="min-w-[16rem] border border-[var(--psc-border)] bg-white px-2 py-2 font-normal"
              >
                <option value="party_wide">Party-wide (same party, any location)</option>
                <option value="jurisdiction_only">Jurisdiction only (match seat + self-vote)</option>
              </select>
            </label>
            <button
              type="submit"
              className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase text-white"
            >
              Save
            </button>
          </form>
        )}
      </section>

      <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h3 className="font-semibold">Phase controls</h3>
        <p className="mt-2 max-w-2xl text-xs text-[var(--psc-muted)]">
          By default, phases advance on their own: after <strong>filing closes</strong> the race becomes{" "}
          <strong>primary</strong>, and after <strong>primary closes</strong> the database picks each party&apos;s
          nominee from site votes and moves the race to <strong>general</strong> (same rules as{" "}
          <strong>End primary → general + winners</strong>). Anyone loading Elections triggers that check.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-[var(--psc-muted)]">
          <li>
            <strong className="text-[var(--psc-ink)]">Filing</strong> — players file until{" "}
            <code className="font-mono">filing_closes_at</code>.
          </li>
          <li>
            <strong className="text-[var(--psc-ink)]">Primary</strong> — players vote until{" "}
            <code className="font-mono">primary_closes_at</code>, then auto general + winners.
          </li>
          <li>
            <strong className="text-[var(--psc-ink)]">General</strong> — players vote until{" "}
            <code className="font-mono">general_closes_at</code>, then <strong>Finalize</strong> (admin).
          </li>
        </ol>
        <p className="mt-3 text-xs text-[var(--psc-muted)]">
          Use the buttons below to jump phases, adjust deadlines in Supabase if you need more time, or
          re-run closeout manually. <strong>General (skip primary)</strong> skips the primary tally when you do
          not run a primary.
        </p>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          Set phase
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <form action={setElectionPhase}>
            <input type="hidden" name="election_id" value={id} />
            <input type="hidden" name="phase" value="filing" />
            <button type="submit" className="border border-[var(--psc-border)] px-3 py-1 text-xs font-semibold uppercase">
              Filing
            </button>
          </form>
          <form action={setElectionPhase}>
            <input type="hidden" name="election_id" value={id} />
            <input type="hidden" name="phase" value="primary" />
            <button type="submit" className="border border-[var(--psc-border)] px-3 py-1 text-xs font-semibold uppercase">
              Primary
            </button>
          </form>
          <form action={setElectionPhase}>
            <input type="hidden" name="election_id" value={id} />
            <input type="hidden" name="phase" value="general" />
            <button type="submit" className="border border-[var(--psc-border)] px-3 py-1 text-xs font-semibold uppercase">
              General (skip primary tally)
            </button>
          </form>
          <form action={setElectionPhase}>
            <input type="hidden" name="election_id" value={id} />
            <input type="hidden" name="phase" value="closed" />
            <button type="submit" className="border border-[var(--psc-border)] px-3 py-1 text-xs font-semibold uppercase">
              Mark closed (no tally)
            </button>
          </form>
        </div>

        {election.phase === "primary" ? (
          <div className="mt-6 border-t border-[var(--psc-border)] pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
              After primary voting
            </p>
            <p className="mt-1 max-w-xl text-xs text-[var(--psc-muted)]">
              Sets one nominee <strong>per party</strong> from <strong>primary site votes only</strong> (top
              vote-getter in each party; uncontested parties auto-advance). Campaign points are not used.
              Then moves the race to general.
            </p>
            <form action={endPrimarySelectWinners} className="mt-2">
              <input type="hidden" name="election_id" value={id} />
              <button
                type="submit"
                className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase text-white"
              >
                End primary → general + winners
              </button>
            </form>
          </div>
        ) : election.phase === "filing" ? (
          <p className="mt-4 text-xs text-[var(--psc-muted)]">
            When filing is done, click <strong>Primary</strong> above. After players vote in the primary, the{" "}
            <strong>End primary</strong> button will appear here.
          </p>
        ) : null}

        {election.phase === "general" ? (
          <div className="mt-6 border-t border-[var(--psc-border)] pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
              After general voting
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {election.office !== "president" ? (
                <form action={finalizeHouseSenateGeneral}>
                  <input type="hidden" name="election_id" value={id} />
                  <button
                    type="submit"
                    className="border border-green-900 bg-green-950 px-3 py-2 text-xs font-semibold uppercase text-white"
                  >
                    Finalize House/Senate
                  </button>
                </form>
              ) : (
                <form action={finalizePresident} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="election_id" value={id} />
                  <select
                    name="winner_candidate_id"
                    required
                    className="border border-[var(--psc-border)] bg-white px-2 py-2 text-xs"
                  >
                    <option value="">Winner (candidate row)</option>
                    {(candidates ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {names[c.user_id] ?? c.user_id.slice(0, 8)} ({c.party})
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="border border-green-900 bg-green-950 px-3 py-2 text-xs font-semibold uppercase text-white"
                  >
                    Finalize president
                  </button>
                </form>
              )}
            </div>
          </div>
        ) : election.phase !== "closed" ? (
          <p className="mt-4 text-xs text-[var(--psc-muted)]">
            <strong>Finalize</strong> shows here when phase is <span className="font-mono">general</span>.
          </p>
        ) : null}
      </section>

      <section>
        <h3 className="font-semibold">Candidates ({candidates?.length ?? 0})</h3>
        <p className="mt-2 max-w-2xl text-xs text-[var(--psc-muted)]">
          Enter each candidate&apos;s <strong>FEC-style campaign total</strong> (speeches, posters, website,
          endorsements) before you finalize House or Senate. Daily caps and endorsement weights live in{" "}
          <code className="rounded bg-[var(--psc-border)] px-1">web/src/lib/fec.ts</code> — use them when
          summing activity in Discord or a spreadsheet, then paste the total here. For House races,{" "}
          <strong>district PVI lean</strong> is added automatically at finalize on top of this number.
        </p>
        <ul className="mt-3 space-y-3 text-sm">
          {(candidates ?? []).map((c) => (
            <li
              key={c.id}
              className="space-y-2 border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{names[c.user_id] ?? "Unknown"}</span>
                <span className="text-[var(--psc-muted)]">{c.party}</span>
                {c.primary_winner ? (
                  <span className="text-xs font-semibold text-green-800">Primary winner</span>
                ) : null}
              </div>
              <form action={setCandidateCampaignPoints} className="flex flex-wrap items-end gap-2 text-xs">
                <input type="hidden" name="election_id" value={id} />
                <input type="hidden" name="candidate_id" value={c.id} />
                <label className="grid gap-1 font-semibold">
                  Campaign points total
                  <input
                    type="number"
                    name="campaign_points_total"
                    min={0}
                    step={1}
                    defaultValue={Number(c.campaign_points_total ?? 0)}
                    className="w-40 border border-[var(--psc-border)] bg-white px-2 py-1 font-normal"
                  />
                </label>
                <button
                  type="submit"
                  className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-1 font-semibold uppercase text-white"
                >
                  Save
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <form action={deleteElection}>
          <input type="hidden" name="election_id" value={id} />
          <button type="submit" className="text-xs font-semibold uppercase text-red-700 underline">
            Delete election
          </button>
        </form>
      </section>
    </div>
  );
}
