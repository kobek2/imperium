"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  partyNationalBoardAppoint,
  partyNationalBoardRemove,
  partyRuleCastVote,
  partyRuleProposeAmendment,
  partyRuleStartBoilerplateVote,
  partySetMemberCollectLevyRate,
} from "@/app/actions/party-leadership";

type MemberOpt = { id: string; character_name: string };
type BoardRow = { user_id: string; character_name: string };
type OpenProposal = {
  id: string;
  kind: string;
  title: string;
  body_md: string;
  status: string;
};

export type PartyChairLevyAnalytics = {
  allTimeWithheld: number;
  fyWithheld: number;
  fyLabel: string | null;
  payers: number;
  salaryBaseAll: number;
  salaryBaseFy: number;
  byMember: Array<{ user_id: string; character_name: string; total: number; salary_base?: number }>;
};

function clampLevyDecimal(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(0.25, n);
}

function fmtUsd0(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function memberSalaryBase(row: { total: number; salary_base?: number }, savedRate: number): number {
  const b = Number(row.salary_base);
  if (Number.isFinite(b) && b > 0) return b;
  if (savedRate > 0) return Number(row.total ?? 0) / savedRate;
  return 0;
}

export function PartyLeadershipForms({
  partyKey,
  boardLabel,
  isChair,
  memberCollectLevyRate,
  chairLevyAnalytics,
  canProposeRules,
  isBoardVoter,
  members,
  boardRows,
  openProposal,
  boardSize,
  yesVotes,
  noVotes,
}: {
  partyKey: string;
  boardLabel: string;
  isChair: boolean;
  /** Fraction 0–0.25 of each member's government salary slice of hourly collect (RPC-enforced; chair only). */
  memberCollectLevyRate: number;
  /** Salary levy aggregates + per-member rows (chair only; from `party_leadership_analytics`). */
  chairLevyAnalytics: PartyChairLevyAnalytics | null;
  canProposeRules: boolean;
  isBoardVoter: boolean;
  members: MemberOpt[];
  boardRows: BoardRow[];
  openProposal: OpenProposal | null;
  boardSize: number;
  yesVotes: number;
  noVotes: number;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [levyDraftStr, setLevyDraftStr] = useState(() => String(memberCollectLevyRate));

  const parsedDraft = Number.parseFloat(levyDraftStr.trim());
  const previewRate = clampLevyDecimal(Number.isFinite(parsedDraft) ? parsedDraft : 0);
  const previewAll =
    chairLevyAnalytics != null ? Math.round(chairLevyAnalytics.salaryBaseAll * previewRate * 100) / 100 : 0;
  const previewFy =
    chairLevyAnalytics != null ? Math.round(chairLevyAnalytics.salaryBaseFy * previewRate * 100) / 100 : 0;

  const requiredYes = boardSize > 0 ? Math.floor(boardSize / 2) + 1 : 0;
  const remaining = Math.max(0, boardSize - yesVotes - noVotes);

  return (
    <div className="space-y-8">
      {msg ? (
        <p className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-3 text-sm text-[var(--psc-ink)]">
          {msg}
        </p>
      ) : null}

      <section className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">{boardLabel}</h2>
        <p className="text-sm text-[var(--psc-muted)]">
          The chair appoints the national committee board. Only seated board members vote on governing rules; passage
          requires a majority of seated members voting Aye.
        </p>
        {isChair ? (
          <form
            className="flex flex-wrap items-end gap-3 border-t border-[var(--psc-border)] pt-4 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              start(async () => {
                setMsg(null);
                const r = await partyNationalBoardAppoint(fd);
                setMsg(r.message);
                if (r.ok) router.refresh();
              });
            }}
          >
            <input type="hidden" name="party_key" value={partyKey} />
            <label className="grid gap-1 font-semibold">
              Appoint member
              <select name="member_id" required className="min-w-[12rem] border border-[var(--psc-border)] px-2 py-2">
                <option value="">Select…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.character_name || m.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={pending}
              className="rounded border border-[var(--psc-ink)] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)]"
            >
              Add to board
            </button>
          </form>
        ) : null}
        {boardRows.length === 0 ? (
          <p className="text-sm text-[var(--psc-muted)]">No board members appointed yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--psc-border)] border border-[var(--psc-border)] rounded">
            {boardRows.map((r) => (
              <li key={r.user_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-medium text-[var(--psc-ink)]">{r.character_name || r.user_id.slice(0, 8)}</span>
                {isChair ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      start(async () => {
                        setMsg(null);
                        const res = await partyNationalBoardRemove(fd);
                        setMsg(res.message);
                        if (res.ok) router.refresh();
                      });
                    }}
                  >
                    <input type="hidden" name="party_key" value={partyKey} />
                    <input type="hidden" name="member_id" value={r.user_id} />
                    <button
                      type="submit"
                      disabled={pending}
                      className="text-xs font-semibold uppercase tracking-wide text-red-800 underline"
                    >
                      Remove
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isChair ? (
        <section className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Party salary levy (automatic)</h2>
          <p className="text-sm text-[var(--psc-muted)]">
            Set what share of each member&apos;s <strong className="text-[var(--psc-ink)]">government salary</strong> portion
            of an hourly collect (scheduled role pay × hours in that collect) is sent to the party treasury. PAC hourly income
            is excluded. Members do not pay party tax separately — it is withheld when they press{" "}
            <strong className="text-[var(--psc-ink)]">Collect hourly income</strong>. Federal income tax still uses the full
            gross collect for the year; this levy is separate party funding.
          </p>
          <form
            className="flex flex-wrap items-end gap-3 border-t border-[var(--psc-border)] pt-4 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              start(async () => {
                setMsg(null);
                const r = await partySetMemberCollectLevyRate(fd);
                setMsg(r.message);
                if (r.ok) router.refresh();
              });
            }}
          >
            <input type="hidden" name="party_key" value={partyKey} />
            <label className="grid gap-1 font-semibold">
              Salary levy rate (decimal, max 0.25)
              <input
                name="member_collect_levy_rate"
                type="number"
                step="0.005"
                min={0}
                max={0.25}
                value={levyDraftStr}
                onChange={(e) => setLevyDraftStr(e.target.value)}
                required
                className="w-40 border border-[var(--psc-border)] px-2 py-2 font-mono text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className="rounded border border-[var(--psc-ink)] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)]"
            >
              Save levy
            </button>
          </form>
          <p className="text-xs text-[var(--psc-muted)]">
            Saved rate: <span className="font-mono font-semibold text-[var(--psc-ink)]">{memberCollectLevyRate}</span> (
            {(memberCollectLevyRate * 100).toFixed(2)}%).
            {Math.abs(previewRate - memberCollectLevyRate) > 1e-6 ? (
              <>
                {" "}
                Draft in field: <span className="font-mono font-semibold text-[var(--psc-ink)]">{previewRate}</span> (
                {(previewRate * 100).toFixed(2)}%) — totals below update to match the field.
              </>
            ) : null}
          </p>

          {chairLevyAnalytics ? (
            <div className="space-y-4 border-t border-[var(--psc-border)] pt-4">
              <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Salary levy — treasury inflows</h3>
              <p className="text-xs text-[var(--psc-muted)]">
                <strong className="text-[var(--psc-ink)]">Recorded</strong> is what was actually withheld at the saved rate.{" "}
                <strong className="text-[var(--psc-ink)]">Preview</strong> multiplies historical government salary bases from
                levy ledger rows by the rate currently in the field (counterfactual for past collects; PAC excluded). Saving a
                new rate does not change the past — it only affects future collects.
              </p>
              {chairLevyAnalytics.payers === 0 && chairLevyAnalytics.allTimeWithheld <= 0 ? (
                <p className="rounded border border-amber-800/40 bg-amber-50/80 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100">
                  All zeros means there are still no <span className="font-mono">party_collect_levy</span> ledger rows for this
                  party. Those rows are written only when an affiliated member runs{" "}
                  <strong className="text-[var(--psc-ink)] dark:text-amber-50">Collect hourly income</strong> and that collect
                  includes <strong className="text-[var(--psc-ink)] dark:text-amber-50">scheduled role (government) pay</strong>{" "}
                  while the saved levy rate is above zero. If everyone&apos;s collect is PAC-only (no role hourly), or nobody has
                  collected since the rate was raised, totals stay at $0.
                </p>
              ) : null}
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">All time (recorded)</dt>
                  <dd className="mt-1 font-mono text-lg text-[var(--psc-ink)]">{fmtUsd0(chairLevyAnalytics.allTimeWithheld)}</dd>
                </div>
                <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    Active fiscal year (recorded)
                    {chairLevyAnalytics.fyLabel ? (
                      <span className="mt-0.5 block font-normal normal-case text-[var(--psc-muted)]">
                        ({chairLevyAnalytics.fyLabel})
                      </span>
                    ) : null}
                  </dt>
                  <dd className="mt-1 font-mono text-lg text-[var(--psc-ink)]">{fmtUsd0(chairLevyAnalytics.fyWithheld)}</dd>
                </div>
                <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    Members with a levy withheld (ever)
                  </dt>
                  <dd className="mt-1 font-mono text-lg text-[var(--psc-ink)]">{chairLevyAnalytics.payers}</dd>
                </div>
                <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3 sm:col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    Preview at field rate ({(previewRate * 100).toFixed(2)}%)
                  </dt>
                  <dd className="mt-1 font-mono text-[var(--psc-ink)]">
                    All time: {fmtUsd0(previewAll)}
                    <span className="mx-2 text-[var(--psc-muted)]">·</span>
                    This fiscal year: {fmtUsd0(previewFy)}
                  </dd>
                </div>
              </dl>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">By member (top 40)</h4>
                {chairLevyAnalytics.byMember.length > 0 ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-[var(--psc-border)] text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
                          <th className="py-2 pr-3">Member</th>
                          <th className="py-2 text-right">Withheld (recorded)</th>
                          <th className="py-2 text-right">At field rate (preview)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chairLevyAnalytics.byMember.map((row) => {
                          const base = memberSalaryBase(row, memberCollectLevyRate);
                          const rowPreview = Math.round(base * previewRate * 100) / 100;
                          return (
                            <tr key={row.user_id} className="border-b border-[var(--psc-border)]/60">
                              <td className="py-2 pr-3 font-medium text-[var(--psc-ink)]">
                                {row.character_name?.trim() || row.user_id.slice(0, 8)}
                              </td>
                              <td className="py-2 text-right font-mono tabular-nums text-[var(--psc-ink)]">
                                {fmtUsd0(Number(row.total ?? 0))}
                              </td>
                              <td className="py-2 text-right font-mono tabular-nums text-[var(--psc-ink)]">
                                {fmtUsd0(rowPreview)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-[var(--psc-muted)]">
                    No per-member levy rows yet. Members need at least one qualifying collect (role pay in the collect, levy
                    rate &gt; 0 at collect time) before names appear here.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--psc-muted)]">
              Levy aggregates could not be loaded (try refreshing). Saving the rate still applies once the server accepts it.
            </p>
          )}
        </section>
      ) : null}

      <section className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Governing rules</h2>
        <p className="text-sm text-[var(--psc-muted)]">
          Start from the party boilerplate (chair only), then amend with board votes. Only one open proposal at a time.
        </p>
        {isChair ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              start(async () => {
                setMsg(null);
                const r = await partyRuleStartBoilerplateVote(fd);
                setMsg(r.message);
                if (r.ok) router.refresh();
              });
            }}
          >
            <input type="hidden" name="party_key" value={partyKey} />
            <button
              type="submit"
              disabled={pending || Boolean(openProposal)}
              className="rounded border border-[var(--psc-ink)] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)] disabled:opacity-40"
            >
              Open boilerplate ratification vote
            </button>
          </form>
        ) : null}
        {canProposeRules ? (
          <form
            className="grid max-w-2xl gap-3 border-t border-[var(--psc-border)] pt-4 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              start(async () => {
                setMsg(null);
                const r = await partyRuleProposeAmendment(fd);
                setMsg(r.message);
                if (r.ok) router.refresh();
              });
            }}
          >
            <input type="hidden" name="party_key" value={partyKey} />
            <label className="grid gap-1 font-semibold">
              Amendment title
              <input name="title" required className="border border-[var(--psc-border)] px-2 py-2" placeholder="Title" />
            </label>
            <label className="grid gap-1 font-semibold">
              Amendment text (markdown)
              <textarea
                name="body_md"
                required
                rows={8}
                className="border border-[var(--psc-border)] px-2 py-2 font-mono text-xs"
                placeholder="Proposed language…"
              />
            </label>
            <button
              type="submit"
              disabled={pending || Boolean(openProposal)}
              className="w-fit rounded border border-[var(--psc-ink)] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)] disabled:opacity-40"
            >
              File amendment for board vote
            </button>
          </form>
        ) : null}
        {openProposal ? (
          <div className="space-y-3 border-t border-[var(--psc-border)] pt-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Open vote</h3>
            <p className="font-semibold text-[var(--psc-ink)]">{openProposal.title}</p>
            <p className="text-xs text-[var(--psc-muted)]">
              {openProposal.kind === "boilerplate" ? "Boilerplate ratification" : "Amendment"} · Aye {yesVotes} · Nay{" "}
              {noVotes} · Board size {boardSize}
              {boardSize > 0 ? ` · Majority threshold ${requiredYes} Aye` : ""}
              {remaining > 0 ? ` · ${remaining} member(s) not yet voted` : ""}
            </p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3 text-xs text-[var(--psc-ink)]">
              {openProposal.body_md}
            </pre>
            {isBoardVoter ? (
              <div className="flex flex-wrap gap-2">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    start(async () => {
                      setMsg(null);
                      const r = await partyRuleCastVote(fd);
                      setMsg(r.message);
                      if (r.ok) router.refresh();
                    });
                  }}
                >
                  <input type="hidden" name="party_key" value={partyKey} />
                  <input type="hidden" name="proposal_id" value={openProposal.id} />
                  <input type="hidden" name="yes" value="true" />
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded border border-emerald-800 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-950"
                  >
                    Vote Aye
                  </button>
                </form>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    start(async () => {
                      setMsg(null);
                      const r = await partyRuleCastVote(fd);
                      setMsg(r.message);
                      if (r.ok) router.refresh();
                    });
                  }}
                >
                  <input type="hidden" name="party_key" value={partyKey} />
                  <input type="hidden" name="proposal_id" value={openProposal.id} />
                  <input type="hidden" name="yes" value="false" />
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded border border-red-800 bg-red-50 px-4 py-2 text-xs font-semibold text-red-950"
                  >
                    Vote Nay
                  </button>
                </form>
              </div>
            ) : (
              <p className="text-xs text-[var(--psc-muted)]">Only seated board members may vote on proposals.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--psc-muted)]">No proposal is open right now.</p>
        )}
      </section>
    </div>
  );
}
