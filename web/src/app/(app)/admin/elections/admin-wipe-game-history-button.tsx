"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adminWipeGameHistory } from "@/app/actions/simulation";

export function AdminWipeGameHistoryButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <section className="rounded border-2 border-rose-800 bg-rose-950/10 p-4">
      <h3 className="text-sm font-semibold text-rose-950">Wipe entire game history</h3>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[var(--psc-muted)]">
        Full server reset: elections, votes, bills, role grants, economy ledger, PACs, businesses, NYC city budgets,
        ordinances, council seating, and fiscal years are cleared; every character returns to citizen with $0 and 50%
        approval. City sim returns to Year 1 / sign-ups open with wave-1 mayor + Class A council races, and the RP
        calendar re-anchors to January 2032 (active). Player accounts and character sheets are kept.
      </p>
      {msg ? (
        <p className="mt-3 rounded border border-[var(--psc-border)] bg-white/90 px-2 py-1.5 text-[11px] text-[var(--psc-ink)]">
          {msg}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending}
        className="mt-4 rounded border border-rose-900 bg-rose-950 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110 disabled:opacity-50"
        onClick={() => {
          if (
            !window.confirm(
              "This permanently wipes ALL game history (elections, congress, economy ledger, fiscal years, offices, chat). Characters remain but everyone becomes a citizen with $0. This cannot be undone. Continue?",
            )
          ) {
            return;
          }
          if (
            !window.confirm(
              "Last chance: type OK in the next prompt is not required — only confirm if you are certain.",
            )
          ) {
            return;
          }
          start(async () => {
            setMsg(null);
            try {
              const r = await adminWipeGameHistory();
              setMsg(r.message);
              router.refresh();
            } catch (e) {
              setMsg(e instanceof Error ? e.message : String(e));
            }
          });
        }}
      >
        {pending ? "Wiping…" : "Wipe all game history"}
      </button>
    </section>
  );
}
