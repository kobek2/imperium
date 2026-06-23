"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitCampaignAd } from "@/app/actions/elections";
import { CAMPAIGN_AD_TYPES, type CampaignAdType } from "@/lib/economy-config";
import type { CampaignAdInventory } from "@/lib/campaign-ad-inventory";
import { NavRouteButton } from "@/components/nav-route-button";

type Props = {
  electionId: string;
  inventory: CampaignAdInventory;
  opponentCandidates?: Array<{ id: string; label: string }>;
};

type Flash = {
  adType: CampaignAdType;
  ok: boolean;
  message: string;
  tone: "success" | "warn" | "error";
};

function clampQty(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(max > 0 ? max : 1, Math.min(100, Math.floor(value)));
}

function AdRunCard({
  adType,
  stock,
  electionId,
  opponentCandidates,
  disabled,
  onFlash,
}: {
  adType: CampaignAdType;
  stock: number;
  electionId: string;
  opponentCandidates: Array<{ id: string; label: string }>;
  disabled: boolean;
  onFlash: (flash: Flash) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [qty, setQty] = useState(1);
  const [attackTarget, setAttackTarget] = useState(opponentCandidates[0]?.id ?? "");
  const cfg = CAMPAIGN_AD_TYPES[adType];
  const maxQty = Math.max(0, Math.min(stock, 100));
  const canRun = stock > 0 && !disabled && (adType !== "attack" || opponentCandidates.length > 0);

  function run() {
    const useQty = clampQty(qty, maxQty);
    const fd = new FormData();
    fd.set("election_id", electionId);
    fd.set("ad_type", adType);
    fd.set("qty", String(useQty));
    if (adType === "attack") {
      const target = attackTarget || opponentCandidates[0]?.id;
      if (!target) {
        onFlash({ adType, ok: false, message: "Pick an opponent for attack ads.", tone: "error" });
        return;
      }
      fd.set("attack_target_id", target);
    }

    start(async () => {
      try {
        const res = await submitCampaignAd(fd);
        let message: string;
        let tone: Flash["tone"] = "success";
        if (adType === "attack" && res.outcome === "attack_miss") {
          message = `${useQty === 1 ? "Attack ad" : `${useQty} attack ads`} missed — backlash cost you 1 point.`;
          tone = "warn";
        } else if (adType === "attack" && res.outcome === "attack_hit") {
          message = `${useQty === 1 ? "Attack ad" : `${useQty} attack ads`} landed → opponent −4 points.`;
        } else if (res.points > 0) {
          message = `Ran ${useQty} ${cfg.label}${useQty === 1 ? "" : "s"} · +${res.points} points.`;
        } else {
          message = `Ran ${useQty} ${cfg.label}${useQty === 1 ? "" : "s"}.`;
        }
        if (res.ads_remaining != null) {
          message += ` ${res.ads_remaining.toLocaleString()} left in stock.`;
        }
        if (res.npc_speech) message += " Opponent gave a speech.";
        if (res.npc_counter_attack) message += " They ran a counter-attack.";
        onFlash({ adType, ok: true, message, tone });
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong.";
        onFlash({ adType, ok: false, message: msg, tone: "error" });
      }
    });
  }

  return (
    <div className="flex h-full flex-col gap-3 rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)]/30 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">{cfg.label}</h3>
        <p className="text-xs text-[var(--psc-muted)]">
          {"points" in cfg && cfg.points > 0 ? (
            <>+{cfg.points} pts each</>
          ) : null}
          {"targetPenalty" in cfg && cfg.targetPenalty ? (
            <>
              −{cfg.targetPenalty} pts opponent
              {"successRate" in cfg && cfg.successRate
                ? ` · ${Math.round(cfg.successRate * 100)}% hit`
                : null}
            </>
          ) : null}
        </p>
        <p className="font-mono text-lg font-semibold tabular-nums text-[var(--psc-ink)]">
          {stock.toLocaleString()}
          <span className="ml-1 text-xs font-normal text-[var(--psc-muted)]">in stock</span>
        </p>
      </div>

      {adType === "attack" && opponentCandidates.length > 1 ? (
        <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          Target
          <select
            value={attackTarget}
            onChange={(e) => setAttackTarget(e.target.value)}
            className="rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-[var(--psc-ink)]"
          >
            {opponentCandidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      ) : adType === "attack" && opponentCandidates.length === 1 ? (
        <p className="text-xs text-[var(--psc-muted)]">
          Target: <span className="font-semibold text-[var(--psc-ink)]">{opponentCandidates[0]!.label}</span>
        </p>
      ) : null}

      <div className="mt-auto flex items-end gap-2">
        <label className="grid min-w-[4.5rem] flex-1 gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          Qty
          <input
            type="number"
            min={1}
            max={maxQty || 1}
            value={qty}
            onChange={(e) => setQty(clampQty(Number(e.target.value), maxQty))}
            disabled={!canRun}
            className="rounded border border-[var(--psc-border)] bg-white px-2 py-2 font-mono text-sm font-normal normal-case tracking-normal text-[var(--psc-ink)] disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          disabled={pending || !canRun}
          onClick={run}
          className="shrink-0 rounded-lg border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Running…" : "Run"}
        </button>
      </div>
    </div>
  );
}

export function CampaignAdForm({ electionId, inventory, opponentCandidates = [] }: Props) {
  const [flash, setFlash] = useState<Flash | null>(null);

  return (
    <section className="space-y-3 border-t border-[var(--psc-border)] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Campaign ads</h3>
        <NavRouteButton href="/economy" className="inline-flex px-2 py-0.5 text-[10px]">
          Buy more
        </NavRouteButton>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <AdRunCard
          adType="persuasion"
          stock={inventory.persuasion}
          electionId={electionId}
          opponentCandidates={opponentCandidates}
          disabled={false}
          onFlash={setFlash}
        />
        <AdRunCard
          adType="attack"
          stock={inventory.attack}
          electionId={electionId}
          opponentCandidates={opponentCandidates}
          disabled={false}
          onFlash={setFlash}
        />
      </div>

      {flash ? (
        <p
          role="status"
          className={`rounded border px-3 py-2 text-xs ${
            flash.tone === "error"
              ? "border-red-300 bg-red-50 text-red-800"
              : flash.tone === "warn"
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-emerald-300 bg-emerald-50 text-emerald-800"
          }`}
        >
          {flash.message}
        </p>
      ) : null}
    </section>
  );
}
