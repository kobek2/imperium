"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  blackjackAction,
  blackjackStart,
  blackjackTableState,
  type BlackjackTableState,
} from "@/app/actions/economy";
import { GAMBLE_BLACKJACK_MAX, GAMBLE_BLACKJACK_MIN } from "@/lib/economy-config";

function rankLabel(r: number): string {
  if (r === 1) return "A";
  if (r === 11) return "J";
  if (r === 12) return "Q";
  if (r === 13) return "K";
  return String(r);
}

function Hand({ cards, hideHole }: { cards: number[]; hideHole?: boolean }) {
  if (hideHole && cards.length >= 1) {
    return (
      <div className="flex flex-wrap gap-1">
        <span className="inline-flex min-w-[2.25rem] justify-center rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2 py-1 font-mono text-sm font-semibold text-[var(--psc-ink)]">
          {rankLabel(cards[0])}
        </span>
        <span className="inline-flex min-w-[2.25rem] justify-center rounded border border-dashed border-[var(--psc-muted)] px-2 py-1 font-mono text-sm text-[var(--psc-muted)]">
          ?
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {cards.map((c, i) => (
        <span
          key={`${i}-${c}`}
          className="inline-flex min-w-[2.25rem] justify-center rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2 py-1 font-mono text-sm font-semibold text-[var(--psc-ink)]"
        >
          {rankLabel(c)}
        </span>
      ))}
    </div>
  );
}

export function EconomyBlackjack() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [table, setTable] = useState<BlackjackTableState | null>(null);
  const [pending, start] = useTransition();

  const sync = useCallback(() => {
    start(async () => {
      const r = await blackjackTableState();
      if (r.ok) setTable(r.state);
    });
  }, []);

  useEffect(() => {
    sync();
  }, [sync]);

  function afterRound() {
    router.refresh();
  }

  const active = Boolean(table?.active);
  const bet = table?.bet ?? 0;

  return (
    <section className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
      <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Blackjack vs the house</h2>
      <p className="text-xs text-[var(--psc-muted)]">
        Six-deck shoe, dealer stands on all 17s, blackjack pays 3:2, one hand at a time. Stakes{" "}
        {GAMBLE_BLACKJACK_MIN.toLocaleString()}–{GAMBLE_BLACKJACK_MAX.toLocaleString()}.
      </p>

      {msg ? <p className="rounded border border-[var(--psc-border)] px-3 py-2 text-sm text-[var(--psc-ink)]">{msg}</p> : null}

      {active && table ? (
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Your cards</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <Hand cards={(table.player_hand ?? []).map(Number)} />
              <span className="font-mono text-[var(--psc-ink)]">Total {table.player_value ?? "—"}</span>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Dealer</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <Hand
                cards={(table.dealer_hand ?? [Number(table.dealer_up ?? 0)]).map(Number)}
                hideHole={Boolean(table.dealer_hole_hidden)}
              />
              {!table.dealer_hole_hidden ? (
                <span className="font-mono text-[var(--psc-ink)]">Total {table.dealer_value ?? "—"}</span>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-[var(--psc-muted)]">
            Bet <span className="font-mono font-semibold text-[var(--psc-ink)]">${bet.toLocaleString()}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const fd = new FormData();
                fd.set("action", "hit");
                start(async () => {
                  setMsg(null);
                  const r = await blackjackAction(fd);
                  setMsg(r.message);
                  if (r.state) setTable(r.state);
                  if (r.ok && !r.state?.active) afterRound();
                });
              }}
              className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-60"
            >
              Hit
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const fd = new FormData();
                fd.set("action", "stand");
                start(async () => {
                  setMsg(null);
                  const r = await blackjackAction(fd);
                  setMsg(r.message);
                  if (r.state) setTable(r.state);
                  if (r.ok && !r.state?.active) afterRound();
                });
              }}
              className="rounded border border-[var(--psc-border)] px-4 py-2 text-xs font-semibold disabled:opacity-60"
            >
              Stand
            </button>
          </div>
        </div>
      ) : table && !table.active && table.outcome ? (
        <div className="space-y-2 text-sm">
          <p className="font-semibold text-[var(--psc-ink)]">{table.message}</p>
          <div className="flex flex-wrap gap-4 text-xs text-[var(--psc-muted)]">
            <span>
              You: <Hand cards={(table.player_hand ?? []).map(Number)} /> ({table.player_value})
            </span>
            <span>
              Dealer: <Hand cards={(table.dealer_hand ?? []).map(Number)} /> ({table.dealer_value})
            </span>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setTable(null);
              setMsg(null);
              sync();
            }}
            className="rounded border px-3 py-2 text-xs font-semibold"
          >
            New hand
          </button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            start(async () => {
              setMsg(null);
              const r = await blackjackStart(fd);
              setMsg(r.message);
              if (r.state) setTable(r.state);
              if (r.ok) afterRound();
            });
          }}
        >
          <label className="grid gap-1 font-semibold">
            Bet ($)
            <input
              name="bet"
              type="number"
              min={GAMBLE_BLACKJACK_MIN}
              max={GAMBLE_BLACKJACK_MAX}
              step={1000}
              defaultValue={5000}
              className="border px-2 py-1 font-mono"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded border border-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase disabled:opacity-60"
          >
            Deal
          </button>
        </form>
      )}
    </section>
  );
}
