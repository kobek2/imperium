"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import {
  declarePartyCandidacy,
  finalizePartyOfficerElection,
  partyTransferTreasuryToMember,
  togglePartyOfficerVote,
  withdrawPartyOfficerCandidacy,
} from "@/app/actions/party";
import { ProfileCard, ProfileCardBadge, profilePath, type ProfileCardData } from "@/components/profile-card";
import { SubmitButton } from "@/components/submit-button";

const OFFICES = [
  { key: "chair", label: "Chair" },
  { key: "vice_chair", label: "Vice chair" },
  { key: "treasurer", label: "Treasurer" },
] as const;

type OfficeKey = (typeof OFFICES)[number]["key"];

type CandRow = { user_id: string; character_name: string | null };
type OfficerRow = { party_key: string; office: string; user_id: string | null; since: string };
type VoteAgg = { candidate_id: string; votes: number; name: string };
type MemberRow = {
  id: string;
  character_name: string;
  wallet_balance: number;
  home_district_code: string | null;
};

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** `YYYY-MM-DD` RP open date from Postgres `date`. */
function formatRpOpenDate(ymd: string | null): string {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function partyBarSegmentClass(partyKey: string, i: number) {
  const dem = ["bg-blue-900", "bg-blue-700", "bg-blue-500", "bg-blue-400"];
  const rep = ["bg-red-900", "bg-red-700", "bg-red-500", "bg-red-400"];
  const arr = partyKey === "democrat" ? dem : partyKey === "republican" ? rep : ["bg-slate-700", "bg-slate-500", "bg-slate-400"];
  return arr[i % arr.length] ?? "bg-slate-500";
}

function PartyLeadershipVoteSpread({ partyKey, tallies }: { partyKey: string; tallies: VoteAgg[] }) {
  if (tallies.length < 2) return null;
  const total = tallies.reduce((s, t) => s + t.votes, 0);
  return (
    <section className="space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Vote share</h4>
        <span className="text-[10px] text-[var(--psc-muted)]">{total} vote{total === 1 ? "" : "s"}</span>
      </div>
      <div className="flex h-7 w-full overflow-hidden rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)]">
        {tallies.map((t, i) => {
          const pct = total > 0 ? (t.votes / total) * 100 : 100 / tallies.length;
          const seg = partyBarSegmentClass(partyKey, i);
          return (
            <div
              key={t.candidate_id}
              className={`${seg} flex items-center justify-center text-[10px] font-semibold text-white transition-[width]`}
              style={{ width: `${Math.max(0, pct)}%` }}
              title={`${t.name}: ${pct.toFixed(1)}%`}
            >
              {pct > 12 ? `${Math.round(pct)}%` : ""}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {tallies.map((t, i) => {
          const pct = total > 0 ? (t.votes / total) * 100 : 100 / tallies.length;
          const dot = partyBarSegmentClass(partyKey, i);
          return (
            <div key={t.candidate_id} className="flex min-w-0 items-center gap-2">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
              <span className="truncate">
                <span className="font-semibold text-[var(--psc-ink)]">{t.name}</span>
                <span className="ml-1 text-[var(--psc-muted)]">
                  · {pct.toFixed(1)}% · {t.votes} vote{t.votes === 1 ? "" : "s"}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function OfficerCandidateCard({
  partyKey,
  office,
  candUserId,
  profile,
  displayName,
  votes,
  totalVotes,
  nCandidates,
  isYou,
  isLeading,
  selected,
}: {
  partyKey: string;
  office: OfficeKey;
  candUserId: string;
  profile: ProfileCardData;
  displayName: string;
  votes: number;
  totalVotes: number;
  nCandidates: number;
  isYou: boolean;
  isLeading: boolean;
  selected: boolean;
}) {
  const n = Math.max(1, nCandidates);
  const share = totalVotes > 0 ? votes / totalVotes : 1 / n;
  const shareLabel = `${votes} vote${votes === 1 ? "" : "s"}`;

  const badges = (
    <>
      {isYou ? <ProfileCardBadge tone="you">You</ProfileCardBadge> : null}
      {isLeading ? <ProfileCardBadge tone="leading">Leading</ProfileCardBadge> : null}
    </>
  );

  const footer = (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-2xl font-semibold text-[var(--psc-ink)]">{(share * 100).toFixed(1)}%</span>
        <span className="text-[11px] uppercase tracking-wide text-[var(--psc-muted)]">{shareLabel}</span>
      </div>
      <form action={togglePartyOfficerVote}>
        <input type="hidden" name="party_key" value={partyKey} />
        <input type="hidden" name="office" value={office} />
        <input type="hidden" name="candidate_id" value={candUserId} />
        <SubmitButton
          variant={selected ? "selected" : "ghost"}
          pendingLabel={selected ? "Unvoting…" : "Voting…"}
          className="w-full rounded border border-[var(--psc-ink)] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)] transition hover:bg-[var(--psc-canvas)]"
        >
          {selected ? "Unvote" : "Vote"}
        </SubmitButton>
      </form>
      {isYou ? (
        <form action={withdrawPartyOfficerCandidacy}>
          <input type="hidden" name="party_key" value={partyKey} />
          <input type="hidden" name="office" value={office} />
          <SubmitButton
            variant="ghost"
            pendingLabel="Withdrawing…"
            className="w-full rounded border border-amber-800/40 bg-amber-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-950"
          >
            Withdraw candidacy
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );

  return (
    <ProfileCard
      profile={{ ...profile, character_name: displayName }}
      emphasizeParty
      selected={selected}
      badges={badges}
      footer={footer}
      href={profilePath(candUserId) ?? undefined}
    />
  );
}

export function PartyRoom({
  partyKey,
  treasury,
  leadershipPhase,
  leadershipElectionEndsAt,
  nextLeadershipOpensOnRp,
  leadershipOpenOverdue,
  lastLeadershipCompletedAt,
  officers,
  nameById,
  voteRows,
  candidatesByOffice,
  profileById,
  myVoteByOffice,
  viewerId,
  viewerMayRun,
  members,
  canFundTreasury,
  isAdmin,
}: {
  partyKey: string;
  treasury: number;
  leadershipPhase: string;
  leadershipElectionEndsAt: string | null;
  nextLeadershipOpensOnRp: string | null;
  leadershipOpenOverdue: boolean;
  lastLeadershipCompletedAt: string | null;
  officers: OfficerRow[];
  nameById: Record<string, string | null | undefined>;
  voteRows: Array<{ office: string; candidate_id: string }>;
  candidatesByOffice: Record<string, CandRow[]>;
  profileById: Record<string, ProfileCardData>;
  myVoteByOffice: Partial<Record<OfficeKey, string>>;
  viewerId: string;
  viewerMayRun: boolean;
  members: MemberRow[];
  canFundTreasury: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const showLeadershipElectionUi = leadershipPhase === "open";

  function tallyVotes(office: string): VoteAgg[] {
    const m = new Map<string, number>();
    for (const v of voteRows) {
      if (v.office !== office) continue;
      m.set(v.candidate_id, (m.get(v.candidate_id) ?? 0) + 1);
    }
    const name = (id: string) => nameById[id] ?? id.slice(0, 8);
    return [...m.entries()]
      .map(([candidate_id, votes]) => ({ candidate_id, votes, name: name(candidate_id) }))
      .sort((a, b) => b.votes - a.votes);
  }

  return (
    <div className="space-y-10">
      {msg ? <p className="rounded border px-4 py-3 text-sm">{msg}</p> : null}

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <p className="text-sm text-[var(--psc-muted)]">Treasury balance</p>
        <p className="mt-1 font-mono text-2xl font-semibold text-[var(--psc-ink)]">
          ${treasury.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </p>
      </section>

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Leadership cycle</h2>
        {leadershipOpenOverdue ? (
          <p className="mt-2 rounded border border-amber-700/40 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            That RP open date has passed but the phase is still Idle. Refresh this page once to run the leadership
            scheduler, or ask an admin if it does not advance.
          </p>
        ) : null}
        <dl className="mt-4 grid gap-2 text-sm md:grid-cols-2">
          <div>
            <dt className="font-semibold text-[var(--psc-ink)]">Current phase</dt>
            <dd className="capitalize text-[var(--psc-muted)]">
              {leadershipPhase === "open" ? "Election open" : leadershipPhase}
            </dd>
          </div>
          {leadershipPhase === "open" ? (
            <div>
              <dt className="font-semibold text-[var(--psc-ink)]">Election closes</dt>
              <dd className="text-[var(--psc-muted)]">{formatWhen(leadershipElectionEndsAt)}</dd>
            </div>
          ) : null}
          {leadershipPhase === "idle" ? (
            <div>
              <dt className="font-semibold text-[var(--psc-ink)]">Next election may open (RP date)</dt>
              <dd className="text-[var(--psc-muted)]">{formatRpOpenDate(nextLeadershipOpensOnRp)}</dd>
            </div>
          ) : null}
          {lastLeadershipCompletedAt ? (
            <div>
              <dt className="font-semibold text-[var(--psc-ink)]">Last cycle completed</dt>
              <dd className="text-[var(--psc-muted)]">{formatWhen(lastLeadershipCompletedAt)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="space-y-6">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Current officers</h2>
        <div className="grid items-stretch gap-4 md:grid-cols-3">
          {OFFICES.map((o) => {
            const holder = officers.find((x) => x.office === o.key);
            const uid = holder?.user_id ?? null;
            if (!uid) {
              return (
                <div
                  key={o.key}
                  className="flex min-h-[14rem] flex-col rounded-lg border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-4"
                >
                  <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">{o.label}</h3>
                  <p className="mt-auto text-sm font-medium text-[var(--psc-muted)]">Vacant</p>
                </div>
              );
            }
            const full = profileById[uid];
            const profile: ProfileCardData = full ?? {
              id: uid,
              character_name: nameById[uid] ?? null,
              face_claim_url: null,
              party: partyKey,
              bio: null,
              residence_state: null,
              home_district_code: null,
            };
            return (
              <div key={o.key} className="flex h-full min-w-0 flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">{o.label}</h3>
                <ProfileCard
                  profile={profile}
                  emphasizeParty
                  subtitle={`Since ${formatWhen(holder?.since ?? null)}`}
                  href={profilePath(uid) ?? undefined}
                />
              </div>
            );
          })}
        </div>
      </section>

      {canFundTreasury && members.length > 0 ? (
        <section className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Send treasury to a member</h2>
          <p className="text-sm text-[var(--psc-muted)]">
            As chair or treasurer, you can move party funds into a member’s personal wallet. The money does not add
            campaign points automatically; they choose how to spend it (for example ads on the economy page).
          </p>
          <form
            className="grid max-w-xl gap-3 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              start(async () => {
                setMsg(null);
                const r = await partyTransferTreasuryToMember(fd);
                setMsg(r.message);
                if (r.ok) router.refresh();
              });
            }}
          >
            <input type="hidden" name="party_key" value={partyKey} />
            <label className="grid gap-1 font-semibold">
              Member
              <select name="recipient_id" required className="border px-2 py-2">
                <option value="">Select…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.character_name || m.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 font-semibold">
              Amount (USD)
              <input
                name="amount"
                type="number"
                min={1}
                step={1}
                required
                placeholder="1000"
                className="border px-2 py-2 font-mono"
              />
            </label>
            <button type="submit" disabled={pending} className="w-fit rounded border px-3 py-2 text-xs font-semibold">
              Send from treasury
            </button>
          </form>
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Party members</h2>
        {members.length === 0 ? (
          <p className="text-sm text-[var(--psc-muted)]">No profiles list this affiliation yet.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-[var(--psc-border)]">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="border-b border-[var(--psc-border)] bg-[var(--psc-panel)] text-xs uppercase text-[var(--psc-muted)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">Member</th>
                  <th className="px-3 py-2 font-semibold">Account balance</th>
                  <th className="px-3 py-2 font-semibold">Home district</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-[var(--psc-border)] last:border-0">
                    <td className="px-3 py-2 font-medium text-[var(--psc-ink)]">{m.character_name}</td>
                    <td className="px-3 py-2 font-mono tabular-nums text-[var(--psc-ink)]">
                      ${m.wallet_balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--psc-muted)]">
                      {m.home_district_code ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showLeadershipElectionUi ? (
        <section className="space-y-8 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <div>
            <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Leadership election</h2>
            <p className="mt-2 text-sm text-[var(--psc-muted)]">
              Run for an office, withdraw anytime before the deadline, and vote for any filed candidate. Click the
              same candidate again to remove your vote. Winners are installed when the 24-hour window closes.
            </p>
          </div>

          {OFFICES.map((o) => {
            const cands = candidatesByOffice[o.key] ?? [];
            const tallies = tallyVotes(o.key);
            const totalVotes = tallies.reduce((s, t) => s + t.votes, 0);
            const maxVotes = tallies.length ? Math.max(...tallies.map((t) => t.votes)) : 0;
            const myPick = myVoteByOffice[o.key];
            const alreadyRunning = cands.some((c) => c.user_id === viewerId);

            return (
              <div key={o.key} className="space-y-4 border-t border-[var(--psc-border)] pt-6 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <h3 className="text-base font-semibold text-[var(--psc-ink)]">{o.label}</h3>
                  {viewerMayRun && !alreadyRunning ? (
                    <form action={declarePartyCandidacy} className="shrink-0">
                      <input type="hidden" name="party_key" value={partyKey} />
                      <input type="hidden" name="office" value={o.key} />
                      <SubmitButton
                        variant="ghost"
                        pendingLabel="Filing…"
                        className="rounded border border-[var(--psc-ink)] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)]"
                      >
                        Run for {o.label}
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>

                {cands.length === 0 ? (
                  <p className="text-sm text-[var(--psc-muted)]">No candidates yet for this office.</p>
                ) : (
                  <>
                    <PartyLeadershipVoteSpread partyKey={partyKey} tallies={tallies} />
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {cands.map((c) => {
                        const prof = profileById[c.user_id];
                        const displayName = prof?.character_name?.trim() || c.character_name?.trim() || c.user_id.slice(0, 8);
                        const votes = tallies.find((t) => t.candidate_id === c.user_id)?.votes ?? 0;
                        const isLeading = votes > 0 && votes === maxVotes;
                        const baseProfile: ProfileCardData = prof ?? {
                          character_name: displayName,
                          face_claim_url: null,
                          party: partyKey,
                          bio: null,
                          residence_state: null,
                          home_district_code: null,
                        };
                        return (
                          <OfficerCandidateCard
                            key={c.user_id}
                            partyKey={partyKey}
                            office={o.key}
                            candUserId={c.user_id}
                            profile={baseProfile}
                            displayName={displayName}
                            votes={votes}
                            totalVotes={totalVotes}
                            nCandidates={cands.length}
                            isYou={c.user_id === viewerId}
                            isLeading={isLeading}
                            selected={myPick === c.user_id}
                          />
                        );
                      })}
                    </div>
                  </>
                )}

                {isAdmin ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      start(async () => {
                        setMsg(null);
                        try {
                          const r = await finalizePartyOfficerElection(fd);
                          setMsg(r.message);
                          router.refresh();
                        } catch (err) {
                          setMsg(err instanceof Error ? err.message : "Could not finalize.");
                          router.refresh();
                        }
                      });
                    }}
                    className="border-t border-dashed border-amber-800/30 pt-4"
                  >
                    <input type="hidden" name="party_key" value={partyKey} />
                    <input type="hidden" name="office" value={o.key} />
                    <button
                      type="submit"
                      disabled={pending}
                      className="rounded border border-amber-800 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950"
                    >
                      Admin: finalize & install winner (this office only)
                    </button>
                  </form>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
