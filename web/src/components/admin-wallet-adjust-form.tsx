"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { staffAdjustWalletBalance } from "@/app/actions/economy-admin";

export function AdminWalletAdjustForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
      <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Adjust wallet balance</h2>
      <p className="mt-1 text-xs text-[var(--psc-muted)]">
        Credits or debits a player wallet, writes a <code className="font-mono">staff_adjustment</code> ledger line,
        and requires an audit reason. Use negative dollars to take away. Requires{" "}
        <code className="font-mono">staff_economy</code> or full staff in the database.
      </p>
      {msg ? (
        <p
          className={`mt-3 rounded border px-3 py-2 text-sm ${
            msg.ok ? "border-emerald-700/40 bg-emerald-50 text-emerald-950" : "border-rose-700/40 bg-rose-50 text-rose-950"
          }`}
        >
          {msg.text}
        </p>
      ) : null}
      <form
        className="mt-4 grid max-w-xl gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            setMsg(null);
            const r = await staffAdjustWalletBalance(fd);
            setMsg({ ok: r.ok, text: r.message });
            if (r.ok) router.refresh();
          });
        }}
      >
        <label className="grid gap-1">
          <span className="font-medium text-[var(--psc-ink)]">Player user id (UUID)</span>
          <input
            name="user_id"
            required
            placeholder="00000000-0000-0000-0000-000000000000"
            className="rounded border border-[var(--psc-border)] bg-white px-3 py-2 font-mono text-xs"
          />
        </label>
        <label className="grid gap-1">
          <span className="font-medium text-[var(--psc-ink)]">Amount (USD)</span>
          <input
            name="amount_usd"
            type="number"
            step="0.01"
            required
            placeholder="10000 or -5000"
            className="rounded border border-[var(--psc-border)] bg-white px-3 py-2 font-mono text-xs"
          />
        </label>
        <label className="grid gap-1">
          <span className="font-medium text-[var(--psc-ink)]">Reason (audit)</span>
          <textarea
            name="reason"
            required
            minLength={3}
            rows={2}
            placeholder="e.g. Refund for duplicate PAC charge"
            className="rounded border border-[var(--psc-border)] bg-white px-3 py-2 text-xs"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="justify-self-start rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
        >
          {pending ? "Applying…" : "Apply adjustment"}
        </button>
      </form>
    </section>
  );
}
