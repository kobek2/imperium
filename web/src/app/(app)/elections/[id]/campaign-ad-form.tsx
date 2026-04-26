"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { submitCampaignAd } from "@/app/actions/elections";

type Props = {
  electionId: string;
  office: string;
  adsInventory: number;
  states: Array<{ code: string; name: string }>;
};

async function campaignAdAction(
  _prev: { error: string | null; ok: boolean; spent: number },
  formData: FormData,
): Promise<{ error: string | null; ok: boolean; spent: number }> {
  try {
    const qtyRaw = Number(String(formData.get("qty") ?? "1").trim());
    const qty = Math.max(1, Math.min(99, Math.floor(Number.isFinite(qtyRaw) ? qtyRaw : 1)));
    await submitCampaignAd(formData);
    return { error: null, ok: true, spent: qty };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong.";
    return { error: msg, ok: false, spent: 0 };
  }
}

function CampaignAdButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="w-full rounded-lg border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-60 sm:w-auto"
    >
      {pending ? "Applying ad…" : "Use campaign ad (+1 pt)"}
    </button>
  );
}

export function CampaignAdForm({ electionId, office, adsInventory, states }: Props) {
  const [result, formAction] = useActionState(campaignAdAction, {
    error: null,
    ok: false,
    spent: 0,
  });
  const [qty, setQty] = useState(1);

  return (
    <form action={formAction} className="grid gap-2 border-t border-[var(--psc-border)] pt-4">
      <input type="hidden" name="election_id" value={electionId} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="text-[var(--psc-muted)]">
          Spend one campaign ad from inventory for <strong className="text-[var(--psc-ink)]">+1 point</strong>.
          {office === "president"
            ? " Presidential ads must target a state."
            : " House and Senate ads auto-apply to this race."}
        </p>
        <span className="font-mono text-[var(--psc-ink)]">Ads in inventory: {adsInventory}</span>
      </div>
      {office === "president" ? (
        <label className="grid gap-1 text-xs font-semibold text-[var(--psc-ink)]">
          Target state
          <select
            name="target_state"
            required
            className="w-full max-w-xs rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-sm font-normal"
            defaultValue=""
          >
            <option value="" disabled>
              Pick a state...
            </option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="grid gap-1 text-xs font-semibold text-[var(--psc-ink)]">
        How many ads
        <input
          name="qty"
          type="number"
          min={1}
          max={Math.max(1, adsInventory)}
          value={qty}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) {
              setQty(1);
              return;
            }
            setQty(Math.min(Math.max(1, Math.floor(n)), Math.max(1, adsInventory)));
          }}
          className="w-full max-w-xs rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-sm font-normal"
        />
      </label>
      <CampaignAdButton disabled={adsInventory < 1} />

      {result.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          {result.error}
        </p>
      ) : null}
      {result.ok ? (
        <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {result.spent === 1
            ? "Campaign ad applied. +1 point added."
            : `${result.spent} campaign ads applied. +${result.spent} points added.`}
        </p>
      ) : null}
    </form>
  );
}
