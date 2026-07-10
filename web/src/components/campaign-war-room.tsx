"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  advanceCampaignTurn,
  bootCampaignManagerSeason,
  disableRivalStrategist,
  enrollAsPartyStrategist,
  type CampaignActionResult,
} from "@/app/actions/campaign-manager";
import { NavRouteButton } from "@/components/nav-route-button";
import { WarRoomLegislativeRound } from "@/components/war-room-legislative-round";
import { WarRoomIntelFeed } from "@/components/war-room-intel-feed";
import { WarRoomPacPanel } from "@/components/war-room-pac-panel";
import { WarRoomPhaseBanner } from "@/components/war-room-phase-banner";
import { RIVAL_DIFFICULTY_LABELS, type RivalDifficulty } from "@/lib/campaign-manager-config";
import type { CampaignWarRoomData } from "@/lib/campaign-manager-data";

function formatMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function partyLabel(party: string): string {
  if (party === "democrat") return "Democratic";
  if (party === "republican") return "Republican";
  return party;
}

function phaseBadge(phase: string): string {
  if (phase === "general") return "General";
  if (phase === "primary") return "Primary";
  if (phase === "filing") return "Filing";
  return phase;
}

type HubTab = "command" | "elections" | "council";

export function CampaignWarRoom({
  data,
  isAdmin,
  userParty,
}: {
  data: CampaignWarRoomData;
  isAdmin: boolean;
  userParty: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<CampaignActionResult | null>(null);
  const [difficulty, setDifficulty] = useState<RivalDifficulty>("normal");
  const [pacName, setPacName] = useState("Democratic Victory Fund");
  const defaultTab: HubTab = data.dayCycle.phase === "council" ? "council" : "elections";
  const [tab, setTab] = useState<HubTab>(defaultTab);

  const {
    status,
    dayCycle,
    chamber,
    races,
    rivalIntel,
    legislativeRound,
    presidentElectionId,
    pacTargets,
    pacFundingSummaries,
    pacStates,
    generalElectionOpen,
    economyFrozen,
  } = data;

  const humanLabel = partyLabel(status.humanParty);
  const rivalLabel = partyLabel(status.rivalParty);
  const canEnroll =
    status.active &&
    !status.isHumanStrategist &&
    !status.humanStrategistUserId &&
    userParty === status.humanParty;

  function run(fn: () => Promise<CampaignActionResult>) {
    start(async () => {
      setFlash(null);
      const r = await fn();
      setFlash(r);
      if (r.ok) router.refresh();
    });
  }

  if (!status.active) {
    return (
      <section className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <h2 className="text-lg font-semibold">Campaign Manager season</h2>
        <p className="max-w-2xl text-sm text-[var(--psc-muted)]">
          Command the Democratic war room in Millbrook: 5 council session turns, then 10 election turns for mayor +
          ward PAC warfare — repeat.
        </p>
        {isAdmin ? (
          <div className="space-y-3 rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/40 p-4">
            <p className="text-sm font-medium text-[var(--psc-ink)]">Admin: boot Season 0</p>
            <label className="block text-xs text-[var(--psc-muted)]">
              Rival difficulty
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as RivalDifficulty)}
                className="mt-1 block w-full max-w-md rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-2 py-1.5 text-sm"
              >
                {(Object.keys(RIVAL_DIFFICULTY_LABELS) as RivalDifficulty[]).map((key) => (
                  <option key={key} value={key}>
                    {RIVAL_DIFFICULTY_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => bootCampaignManagerSeason(difficulty))}
              className="rounded bg-[var(--psc-seal)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Boot season (Mayor + Council)
            </button>
          </div>
        ) : (
          <p className="text-sm text-[var(--psc-muted)]">Waiting for staff to boot the season.</p>
        )}
        {flash ? (
          <p className={`text-sm ${flash.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
            {flash.message}
          </p>
        ) : null}
      </section>
    );
  }

  const tabs: { id: HubTab; label: string }[] = [
    { id: "command", label: "Command" },
    { id: "elections", label: "Elections & PAC" },
    { id: "council", label: "Council session" },
  ];

  return (
    <div className="space-y-6">
      <WarRoomPhaseBanner
        cycle={dayCycle}
        rivalLabel={status.rivalLabel}
        rivalEnabled={status.rivalEnabled}
        canEndTurn={status.isHumanStrategist}
        endTurnPending={pending}
        onEndTurn={status.isHumanStrategist ? () => run(advanceCampaignTurn) : undefined}
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Your PAC" value={formatMoney(status.myPacTreasury)} sub={status.myPacName ?? undefined} />
        <StatCard label="Rival war chest" value={formatMoney(status.rivalTreasury)} sub={status.rivalDifficulty} />
        <StatCard label="Council" value={`${chamber.councilDem} D · ${chamber.councilRep} R`} sub="7 wards" />
        <StatCard
          label="Mayor"
          value={chamber.mayorParty ? partyLabel(chamber.mayorParty) : "Open"}
          sub="Millbrook"
        />
      </section>

      {canEnroll ? (
        <section className="rounded border border-[var(--psc-accent)]/40 bg-[var(--psc-panel)] p-6">
          <h2 className="text-lg font-semibold">Claim {humanLabel} Party Leader</h2>
          <p className="mt-1 text-sm text-[var(--psc-muted)]">
            Starter PAC grant: {formatMoney(status.starterGrant)}. You run the war room; the machine runs the GOP.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-xs text-[var(--psc-muted)]">
              PAC name
              <input
                value={pacName}
                onChange={(e) => setPacName(e.target.value)}
                className="mt-1 block w-64 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => enrollAsPartyStrategist(pacName))}
              className="rounded bg-[var(--psc-seal)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Enroll as strategist
            </button>
          </div>
        </section>
      ) : null}

      {status.isHumanStrategist ? (
        <p className="text-sm text-[var(--psc-ink)]">
          <span className="font-semibold">{humanLabel} strategist</span>
          {status.rivalEnabled ? (
            <>
              {" "}
              vs <span className="font-semibold">{status.rivalLabel}</span> ({status.rivalDifficulty})
            </>
          ) : (
            " · rival AI off"
          )}
        </p>
      ) : null}

      <nav className="flex flex-wrap gap-2 border-b border-[var(--psc-border)] pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              tab === t.id
                ? "bg-[var(--psc-seal)] text-white"
                : "text-[var(--psc-muted)] hover:bg-[var(--psc-canvas)] hover:text-[var(--psc-ink)]"
            }`}
          >
            {t.label}
            {t.id === "elections" && dayCycle.phase === "elections" ? " · live" : null}
            {t.id === "council" && dayCycle.phase === "council" ? " · live" : null}
            {t.id === "command" ? null : t.id !== dayCycle.phase ? " · locked" : null}
          </button>
        ))}
      </nav>

      {tab === "command" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
            <h3 className="text-sm font-semibold">Turn rhythm</h3>
            <p className="mt-2 text-sm text-[var(--psc-muted)]">
              {dayCycle.phaseDescription} When you&apos;re ready, hit <strong>End turn →</strong> in the banner above —
              the rival AI responds, then the next turn begins.
            </p>
            <p className="mt-2 text-xs text-[var(--psc-muted)]">
              {dayCycle.phase === "council"
                ? "Complete your council legislative round — the turn advances automatically when done."
                : "File PAC money freely during election turns, then use End turn →"}
            </p>
          </section>
          <WarRoomIntelFeed rows={rivalIntel} />
          <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
            <h3 className="text-sm font-semibold">Battle map snapshot</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--psc-border)] text-[var(--psc-muted)]">
                    <th className="py-1 pr-2">Race</th>
                    <th className="py-1 pr-2">Phase</th>
                    <th className="py-1 pr-2">You</th>
                    <th className="py-1">Rival</th>
                  </tr>
                </thead>
                <tbody>
                  {races.slice(0, 8).map((race) => (
                    <tr key={race.electionId} className="border-b border-[var(--psc-border)]/50">
                      <td className="py-1.5 pr-2">
                        <Link href={`/elections/${race.electionId}`} className="font-medium underline-offset-2 hover:underline">
                          {race.seatLabel}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-2">{phaseBadge(race.phase)}</td>
                      <td className="py-1.5 pr-2 tabular-nums">{formatMoney(race.ourPacSpend)}</td>
                      <td className="py-1.5 tabular-nums">{formatMoney(race.rivalPacSpend)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {presidentElectionId ? (
                <NavRouteButton href={`/elections/${presidentElectionId}`}>Presidential map</NavRouteButton>
              ) : null}
              <NavRouteButton href="/elections">All races</NavRouteButton>
              <NavRouteButton href="/council">City Council</NavRouteButton>
              <NavRouteButton href="/mayor">Mayor&apos;s Office</NavRouteButton>
            </div>
          </section>
        </div>
      ) : null}

      {tab === "elections" && dayCycle.phase !== "elections" ? (
        <p className="rounded border border-dashed border-[var(--psc-border)] px-3 py-2 text-sm text-[var(--psc-muted)]">
          Elections unlock on turns {dayCycle.congressTurns + 1}–{dayCycle.cycleTurns}. You&apos;re on congress turn{" "}
          {dayCycle.turnInPhase} of {dayCycle.congressTurns}. Use <strong>End turn →</strong> when your caucus work is done.
        </p>
      ) : null}

      {tab === "elections" && dayCycle.phase === "elections" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
            <h3 className="text-sm font-semibold">PAC operations</h3>
            <div className="mt-3">
              <WarRoomPacPanel
                treasury={status.myPacTreasury}
                pacName={status.myPacName}
                targets={pacTargets}
                fundingSummaries={pacFundingSummaries}
                states={pacStates}
                generalElectionOpen={generalElectionOpen}
                economyFrozen={economyFrozen}
                electionsWindow={dayCycle.phase === "elections"}
                isStrategist={status.isHumanStrategist}
              />
            </div>
          </section>
          <WarRoomIntelFeed rows={rivalIntel.filter((r) => r.kind.startsWith("pac"))} />
          <section className="lg:col-span-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
            <h3 className="text-sm font-semibold">Full battle map</h3>
            <RaceTable races={races} humanLabel={humanLabel} rivalLabel={rivalLabel} />
          </section>
        </div>
      ) : null}

      {tab === "council" && dayCycle.phase !== "council" ? (
        <p className="rounded border border-dashed border-[var(--psc-border)] px-3 py-2 text-sm text-[var(--psc-muted)]">
          Council session unlocks on turns 1–{dayCycle.councilTurns}. You&apos;re on election turn {dayCycle.turnInPhase}{" "}
          of {dayCycle.electionTurns}. Finish PAC work, then use <strong>End turn →</strong> to advance the season.
        </p>
      ) : null}

      {tab === "council" && dayCycle.phase === "council" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="space-y-4 lg:col-span-2">
            <WarRoomLegislativeRound
              bundle={legislativeRound}
              congressWindow={dayCycle.phase === "council"}
              isStrategist={status.isHumanStrategist}
            />
          </section>
          <WarRoomIntelFeed
            rows={rivalIntel.filter((r) =>
              ["bill_filed", "whip", "bribe", "round_advance", "law_signed", "law_vetoed", "leadership"].includes(
                r.kind,
              ),
            )}
          />
        </div>
      ) : null}

      {isAdmin ? (
        <section className="rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/30 p-4 text-sm">
          <p className="font-medium">Admin</p>
          <button
            type="button"
            disabled={pending || !status.rivalEnabled}
            onClick={() => run(() => disableRivalStrategist())}
            className="mt-2 rounded border border-[var(--psc-border)] px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Disable rival AI
          </button>
        </section>
      ) : null}

      {flash ? (
        <p className={`text-sm ${flash.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
          {flash.message}
        </p>
      ) : null}
    </div>
  );
}

function RaceTable({
  races,
  humanLabel,
  rivalLabel,
}: {
  races: CampaignWarRoomData["races"];
  humanLabel: string;
  rivalLabel: string;
}) {
  if (races.length === 0) return <p className="mt-2 text-sm text-[var(--psc-muted)]">No open races.</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--psc-border)] text-xs uppercase tracking-wide text-[var(--psc-muted)]">
            <th className="py-2 pr-3">Race</th>
            <th className="py-2 pr-3">Phase</th>
            <th className="py-2 pr-3">{humanLabel}</th>
            <th className="py-2 pr-3">{rivalLabel}</th>
            <th className="py-2 pr-3">Your PAC</th>
            <th className="py-2">Rival PAC</th>
          </tr>
        </thead>
        <tbody>
          {races.map((race) => (
            <tr key={race.electionId} className="border-b border-[var(--psc-border)]/60">
              <td className="py-2 pr-3">
                <Link href={`/elections/${race.electionId}`} className="font-medium text-[var(--psc-accent)] underline-offset-2 hover:underline">
                  {race.seatLabel}
                </Link>
              </td>
              <td className="py-2 pr-3 text-[var(--psc-muted)]">{phaseBadge(race.phase)}</td>
              <td className="py-2 pr-3">{race.ourCandidateName}</td>
              <td className="py-2 pr-3">{race.rivalCandidateName}</td>
              <td className="py-2 pr-3 tabular-nums">{formatMoney(race.ourPacSpend)}</td>
              <td className="py-2 tabular-nums">{formatMoney(race.rivalPacSpend)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--psc-muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--psc-ink)]">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-[var(--psc-muted)]">{sub}</p> : null}
    </div>
  );
}
