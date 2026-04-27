"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { submitCampaignAd } from "@/app/actions/elections";

type Props = {
  electionId: string;
  office: string;
  adsInventory: number;
  states: Array<{ code: string; name: string }>;
};

type AdActionState = {
  error: string | null;
  ok: boolean;
  spent: number;
  targetState: string | null;
  /** Authoritative count from `economy_use_campaign_ad` after spend (matches header after refresh). */
  adsRemaining: number | null;
};

async function campaignAdAction(
  _prev: AdActionState,
  formData: FormData,
): Promise<AdActionState> {
  try {
    const res = await submitCampaignAd(formData);
    return {
      error: null,
      ok: true,
      spent: res.qty,
      targetState: res.target_state,
      adsRemaining: res.ads_remaining,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong.";
    return { error: msg, ok: false, spent: 0, targetState: null, adsRemaining: null };
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
  const router = useRouter();
  const [result, formAction] = useActionState(campaignAdAction, {
    error: null,
    ok: false,
    spent: 0,
    targetState: null,
    adsRemaining: null,
  });

  useEffect(() => {
    if (!result.ok || result.spent < 1) return;
    router.refresh();
  }, [result.ok, result.spent, router]);

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
          max={Math.max(1, Math.min(5000, adsInventory))}
          defaultValue={1}
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
            ? `Campaign ad applied. +1 point${result.targetState ? ` in ${result.targetState}` : ""}.`
            : `${result.spent} campaign ads applied. +${result.spent} points${result.targetState ? ` in ${result.targetState}` : ""}.`}
          {result.adsRemaining != null ? (
            <>
              {" "}
              <span className="font-semibold">Ads remaining (inventory): {result.adsRemaining}.</span>
            </>
          ) : null}
          {office === "president" && result.targetState
            ? " Map totals update for that state only — open the matching tile to confirm."
            : null}
        </p>
      ) : null}
    </form>
  );
}
