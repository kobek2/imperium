"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buyCampaignAds } from "@/app/actions/economy";
import { CAMPAIGN_AD_TYPES, type CampaignAdType } from "@/lib/economy-config";
import type { CampaignAdInventory } from "@/lib/campaign-ad-inventory";
import { NavRouteButton } from "@/components/nav-route-button";

export type EconomyCampaignRace = {
  electionId: string;
  candidateId: string;
  label: string;
  opponents: Array<{ id: string; label: string }>;
};

export function EconomyCampaignAds({
  inventory,
  economyFrozen,
  onFlash,
}: {
  inventory: CampaignAdInventory;
  economyFrozen: boolean;
  onFlash: (message: string, ok: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [qty, setQty] = useState(1);

  function buyAd(adType: CampaignAdType) {
    const fd = new FormData();
    fd.set("ad_type", adType);
    fd.set("qty", String(qty));

    start(async () => {
      const r = await buyCampaignAds(fd);
      onFlash(r.message, r.ok);
      if (r.ok) router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
      <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Campaign ads</h2>

      <div className="flex flex-wrap items-center gap-4 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/40 px-4 py-3 text-sm">
        <span>
          Persuasion in stock:{" "}
          <strong className="font-mono text-[var(--psc-ink)]">{inventory.persuasion.toLocaleString()}</strong>
        </span>
        <span>
          Attack in stock:{" "}
          <strong className="font-mono text-[var(--psc-ink)]">{inventory.attack.toLocaleString()}</strong>
        </span>
      </div>

      <label className="grid max-w-[10rem] gap-1 text-xs font-semibold">
        Quantity per purchase
        <input
          type="number"
          min={1}
          max={5000}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Math.min(5000, Number(e.target.value) || 1)))}
          className="rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-sm font-normal"
        />
      </label>

      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        {(Object.entries(CAMPAIGN_AD_TYPES) as [CampaignAdType, (typeof CAMPAIGN_AD_TYPES)[CampaignAdType]][]).map(
          ([key, cfg]) => {
            const unitTotal = cfg.cost * qty;
            const inStock = key === "persuasion" ? inventory.persuasion : inventory.attack;
            return (
              <li key={key}>
                <button
                  type="button"
                  disabled={pending || economyFrozen}
                  onClick={() => buyAd(key)}
                  className="w-full rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-3 text-left transition hover:border-[var(--psc-ink)] hover:bg-[color-mix(in_srgb,var(--psc-ink)_5%,var(--psc-canvas))] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="font-medium">Buy {cfg.label}</span>
                  <span className="ml-2 font-mono text-xs">${unitTotal.toLocaleString()}</span>
                  {"points" in cfg && cfg.points > 0 ? (
                    <span className="text-[var(--psc-muted)]"> · +{cfg.points} pts each</span>
                  ) : null}
                  {"targetPenalty" in cfg && cfg.targetPenalty ? (
                    <span className="text-[var(--psc-muted)]"> · −{cfg.targetPenalty} pts opponent</span>
                  ) : null}
                  {"successRate" in cfg && cfg.successRate ? (
                    <span className="ml-1 text-xs text-[var(--psc-muted)]">
                      · {Math.round(cfg.successRate * 100)}% hit
                    </span>
                  ) : null}
                  <span className="mt-1 block text-[11px] text-[var(--psc-muted)]">
                    {inStock.toLocaleString()} already in inventory
                  </span>
                </button>
              </li>
            );
          },
        )}
      </ul>

      <div className="flex flex-wrap gap-2">
        <NavRouteButton href="/elections">Elections</NavRouteButton>
      </div>
    </section>
  );
}
