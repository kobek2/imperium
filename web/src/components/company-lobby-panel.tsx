"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { fundCompanyLobbyOffer } from "@/app/actions/economy";
import {
  buildSectorBillMarkdown,
  buildSectorBillTitle,
  formatSectorEffectPct,
  SECTOR_BILL_MEASURES,
  sectorBillMeasure,
} from "@/lib/legislation-stock";
import { formatUsd, sectorLabel } from "@/lib/stock-market";

export type ShareholderRow = {
  user_id: string;
  character_name: string | null;
  shares: number;
  ownership_pct: number;
};

export function CompanyLobbyPanel({
  companyId,
  companyName,
  tickerSymbol,
  sector,
  shareholders,
}: {
  companyId: string;
  companyName: string;
  tickerSymbol: string;
  sector: string;
  shareholders: ShareholderRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);
  const [recipientId, setRecipientId] = useState(shareholders[0]?.user_id ?? "");
  const [measureKey, setMeasureKey] = useState<(typeof SECTOR_BILL_MEASURES)[number]["key"]>("subsidy");
  const [amount, setAmount] = useState(500_000);
  const [message, setMessage] = useState("");

  const measure = sectorBillMeasure(measureKey);
  const previewTitle = useMemo(
    () => buildSectorBillTitle(sector, measureKey, companyName),
    [sector, measureKey, companyName],
  );
  const previewMd = useMemo(
    () => buildSectorBillMarkdown(sector, measureKey, companyName, tickerSymbol),
    [sector, measureKey, companyName, tickerSymbol],
  );

  if (shareholders.length === 0) {
    return (
      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
        <h2 className="text-base font-semibold">Lobby shareholders</h2>
        <p className="mt-2 text-sm text-[var(--psc-muted)]">
          No outside shareholders yet. Once investors hold stock, you can pay them to file sector legislation in Congress.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
      <h2 className="text-base font-semibold">Lobby shareholders</h2>
      <p className="mt-1 text-xs text-[var(--psc-muted)]">
        Pay a shareholder from your personal wallet to file a <strong>Company sectors</strong> bill benefiting{" "}
        {sectorLabel(sector)}. When the bill is signed into law, public companies in the sector move by the configured
        percentage.
      </p>

      {flash ? (
        <p
          className={`mt-3 rounded border px-3 py-2 text-xs ${
            flash.ok ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-rose-300 bg-rose-50 text-rose-950"
          }`}
        >
          {flash.message}
        </p>
      ) : null}

      <form
        className="mt-4 grid gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setFlash(null);
            const r = await fundCompanyLobbyOffer({
              companyId,
              recipientUserId: recipientId,
              amount,
              measureKey,
              billTitle: previewTitle,
              billContentMd: previewMd,
              message: message.trim() || null,
            });
            setFlash(r);
            if (r.ok) router.refresh();
          });
        }}
      >
        <label className="grid gap-1">
          <span className="text-xs font-semibold text-[var(--psc-muted)]">Shareholder to lobby</span>
          <select
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            className="border border-[var(--psc-border)] bg-white px-3 py-2"
            required
          >
            {shareholders.map((s) => (
              <option key={s.user_id} value={s.user_id}>
                {s.character_name ?? s.user_id.slice(0, 8)} — {s.shares.toLocaleString()} shares (
                {s.ownership_pct.toFixed(1)}%)
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-xs font-semibold text-[var(--psc-muted)]">Legislation type</span>
          <select
            value={measureKey}
            onChange={(e) => setMeasureKey(e.target.value as (typeof SECTOR_BILL_MEASURES)[number]["key"])}
            className="border border-[var(--psc-border)] bg-white px-3 py-2"
          >
            {SECTOR_BILL_MEASURES.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label} ({formatSectorEffectPct(m.stockEffect)} sector impact)
              </option>
            ))}
          </select>
          {measure ? <span className="text-xs text-[var(--psc-muted)]">{measure.description}</span> : null}
        </label>

        <label className="grid gap-1">
          <span className="text-xs font-semibold text-[var(--psc-muted)]">Lobby payment (from your wallet)</span>
          <input
            type="number"
            min={100_000}
            step={50_000}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="border border-[var(--psc-border)] bg-white px-3 py-2 font-mono"
            required
          />
        </label>

        <label className="grid gap-1">
          <span className="text-xs font-semibold text-[var(--psc-muted)]">Message to shareholder (optional)</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder="File this in the House when you can — our sector needs this."
            className="border border-[var(--psc-border)] bg-white px-3 py-2"
          />
        </label>

        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-surface)] p-3 text-xs">
          <p className="font-semibold text-[var(--psc-ink)]">{previewTitle}</p>
          <p className="mt-1 text-[var(--psc-muted)]">
            Market impact if enacted: {sectorLabel(sector)} {formatSectorEffectPct(measure?.stockEffect ?? 0)}
          </p>
        </div>

        <button
          type="submit"
          disabled={pending || !recipientId}
          className="w-fit rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          {pending ? "Sending…" : `Pay ${formatUsd(amount)} & send lobby offer`}
        </button>
      </form>
    </section>
  );
}
