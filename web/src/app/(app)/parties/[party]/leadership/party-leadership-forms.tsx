"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  partyNationalBoardAppoint,
  partyNationalBoardRemove,
  partyRuleCastVote,
  partyRuleProposeAmendment,
  partyRuleStartBoilerplateVote,
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

export function PartyLeadershipForms({
  partyKey,
  boardLabel,
  isChair,
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
