"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { submitCampaignAd } from "@/app/actions/elections";
import { CAMPAIGN_AD_TYPES } from "@/lib/economy-config";

type Props = {
  electionId: string;
  office: string;
  opponentCandidates?: Array<{ id: string; label: string }>;
};

type AdActionState = {
  error: string | null;
  ok: boolean;
  ad_type: string | null;
  points: number;
  cost: number;
  outcome: string | null;
  npc_counter_attack: boolean;
  npc_speech: boolean;
};

async function campaignAdAction(_prev: AdActionState, formData: FormData): Promise<AdActionState> {
  try {
    const res = await submitCampaignAd(formData);
    return {
      error: null,
      ok: true,
      ad_type: res.ad_type ?? null,
      points: res.points ?? 0,
      cost: res.cost ?? 0,
      outcome: res.outcome ?? null,
      npc_counter_attack: Boolean(res.npc_counter_attack),
      npc_speech: Boolean(res.npc_speech),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong.";
    return { error: msg, ok: false, ad_type: null, points: 0, cost: 0, outcome: null, npc_counter_attack: false, npc_speech: false };
  }
}

function CampaignAdButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-60 sm:w-auto"
    >
      {pending ? "Running ad…" : "Run campaign ad"}
    </button>
  );
}

export function CampaignAdForm({ electionId, office, opponentCandidates = [] }: Props) {
  const router = useRouter();
  const [result, formAction] = useActionState(campaignAdAction, {
    error: null,
    ok: false,
    ad_type: null,
    points: 0,
    cost: 0,
    outcome: null,
    npc_counter_attack: false,
    npc_speech: false,
  });
  const [adType, setAdType] = useState("persuasion");

  useEffect(() => {
    if (!result.ok) return;
    router.refresh();
  }, [result.ok, router]);

  return (
    <form action={formAction} className="grid gap-2 border-t border-[var(--psc-border)] pt-4">
      <input type="hidden" name="election_id" value={electionId} />
      <p className="text-xs text-[var(--psc-muted)]">
        Charged from wallet when you run the spot.
        {office === "president" ? " Presidential ads apply to your national ticket." : " Ads apply to your candidacy in this race."}
      </p>
      <label className="grid gap-1 text-xs font-semibold text-[var(--psc-ink)]">
        Ad type
        <select
          name="ad_type"
          value={adType}
          onChange={(e) => setAdType(e.target.value)}
          className="rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-sm font-normal"
        >
          {Object.entries(CAMPAIGN_AD_TYPES).map(([key, cfg]) => (
            <option key={key} value={key}>
              {cfg.label} — ${cfg.cost.toLocaleString()}
              {"points" in cfg && cfg.points > 0 ? ` (+${cfg.points} pts)` : ""}
              {"corrupt" in cfg && cfg.corrupt ? " [illegal]" : ""}
              {"successRate" in cfg && cfg.successRate ? ` [${Math.round(cfg.successRate * 100)}% hit]` : ""}
            </option>
          ))}
        </select>
      </label>
      {adType === "attack" && opponentCandidates.length > 0 ? (
        <label className="grid gap-1 text-xs font-semibold text-[var(--psc-ink)]">
          Attack target
          <select name="attack_target_id" required className="rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-sm font-normal">
            <option value="">Select opponent…</option>
            {opponentCandidates.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
      ) : null}
      <CampaignAdButton />
      {result.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">{result.error}</p>
      ) : null}
      {result.ok ? (
        <p className={`rounded border px-3 py-2 text-xs ${result.outcome === "attack_miss" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>
          {result.outcome === "attack_miss"
            ? `Attack ad missed (−$${result.cost.toLocaleString()}) — backlash cost you 1 point.`
            : result.outcome === "attack_hit"
              ? `Attack ad landed (−$${result.cost.toLocaleString()}) → opponent −4 points.`
              : `${result.ad_type} ad ran (−$${result.cost.toLocaleString()})${result.points > 0 ? ` · +${result.points} points` : ""}.`}
          {result.npc_speech ? " Opponent gave a speech." : ""}
          {result.npc_counter_attack ? " They ran a counter-attack." : ""}
        </p>
      ) : null}
    </form>
  );
}
