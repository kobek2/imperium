"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyCampaignAd } from "@/app/actions/economy";
import { CAMPAIGN_AD_TYPES, type CampaignAdType } from "@/lib/economy-config";
import { NavRouteButton } from "@/components/nav-route-button";

export type EconomyCampaignRace = {
  electionId: string;
  candidateId: string;
  label: string;
  opponents: Array<{ id: string; label: string }>;
};

export function EconomyCampaignAds({
  races,
  characterName,
  economyFrozen,
  onFlash,
}: {
  races: EconomyCampaignRace[];
  characterName?: string | null;
  economyFrozen: boolean;
  onFlash: (message: string, ok: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [activeRaceId, setActiveRaceId] = useState(races[0]?.electionId ?? "");
  const [attackTarget, setAttackTarget] = useState(races[0]?.opponents[0]?.id ?? "");

  const race = races.find((r) => r.electionId === activeRaceId) ?? races[0] ?? null;

  function runAd(adType: CampaignAdType) {
    if (!race) return;
    if (adType === "attack") {
      const target = attackTarget || race.opponents[0]?.id;
      if (!target) {
        onFlash("Pick an opponent for attack ads.", false);
        return;
      }
    }

    const fd = new FormData();
    fd.set("election_id", race.electionId);
    fd.set("candidate_id", race.candidateId);
    fd.set("ad_type", adType);
    if (adType === "attack") {
      fd.set("attack_target_id", attackTarget || race.opponents[0]!.id);
    }

    start(async () => {
      const r = await applyCampaignAd(fd);
      onFlash(r.message, r.ok);
      if (r.ok) router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
      <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Campaign ads</h2>
      <p className="text-sm text-[var(--psc-muted)]">
        Run ads during the general election. Your wallet is charged when you click. Opponents speech every 3 hours and may counter-attack (~40%).
      </p>

      {races.length === 0 ? (
        <>
          <p className="rounded border border-dashed border-[var(--psc-border)] px-3 py-4 text-sm text-[var(--psc-muted)]">
            {characterName ? (
              <>
                Signed in as <strong className="text-[var(--psc-ink)]">{characterName}</strong>.{" "}
              </>
            ) : null}
            No active general-election race on this account. Open{" "}
            <NavRouteButton href="/elections" className="inline-flex px-2 py-0.5 text-xs">
              Elections
            </NavRouteButton>{" "}
            to file or check your race phase.
          </p>
          <ul className="grid gap-2 text-sm sm:grid-cols-2" aria-hidden="true">
            {Object.entries(CAMPAIGN_AD_TYPES).map(([key, cfg]) => (
              <li
                key={key}
                className="rounded border border-[var(--psc-border)] px-3 py-2 opacity-40"
              >
                <span className="font-medium">{cfg.label}</span>
                <span className="ml-2 font-mono text-xs">${cfg.cost.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {races.length > 1 ? (
            <label className="grid max-w-md gap-1 text-xs font-semibold">
              Race
              <select
                value={activeRaceId}
                onChange={(e) => {
                  setActiveRaceId(e.target.value);
                  const next = races.find((r) => r.electionId === e.target.value);
                  setAttackTarget(next?.opponents[0]?.id ?? "");
                }}
                className="rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-sm font-normal"
              >
                {races.map((r) => (
                  <option key={r.electionId} value={r.electionId}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          ) : race ? (
            <p className="text-xs font-semibold text-[var(--psc-ink)]">Race: {race.label}</p>
          ) : null}

          {race && race.opponents.length > 1 ? (
            <label className="grid max-w-md gap-1 text-xs font-semibold">
              Attack target
              <select
                value={attackTarget}
                onChange={(e) => setAttackTarget(e.target.value)}
                className="rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-sm font-normal"
              >
                {race.opponents.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {(Object.entries(CAMPAIGN_AD_TYPES) as [CampaignAdType, (typeof CAMPAIGN_AD_TYPES)[CampaignAdType]][]).map(
              ([key, cfg]) => (
                <li key={key}>
                  <button
                    type="button"
                    disabled={pending || economyFrozen || !race}
                    onClick={() => runAd(key)}
                    className="w-full rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-3 text-left transition hover:border-[var(--psc-ink)] hover:bg-[color-mix(in_srgb,var(--psc-ink)_5%,var(--psc-canvas))] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="font-medium">{cfg.label}</span>
                    <span className="ml-2 font-mono text-xs">${cfg.cost.toLocaleString()}</span>
                    {"points" in cfg && cfg.points > 0 ? (
                      <span className="text-[var(--psc-muted)]"> · +{cfg.points} pts</span>
                    ) : null}
                    {"corrupt" in cfg && cfg.corrupt ? (
                      <span className="ml-1 text-xs text-rose-700">illegal</span>
                    ) : null}
                    {"successRate" in cfg && cfg.successRate ? (
                      <span className="ml-1 text-xs text-[var(--psc-muted)]">
                        · {Math.round(cfg.successRate * 100)}% hit
                      </span>
                    ) : null}
                  </button>
                </li>
              ),
            )}
          </ul>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <NavRouteButton href="/economy/pac">PAC</NavRouteButton>
        <NavRouteButton href="/elections">Elections</NavRouteButton>
      </div>
    </section>
  );
}
