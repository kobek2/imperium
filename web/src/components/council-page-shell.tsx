"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { ProfileImageWithFallback } from "@/components/profile-image-with-fallback";
import { profilePath } from "@/components/profile-card";
import Link from "next/link";
import type { CityOfficeData, CouncilRosterMember } from "@/lib/city-office-data";
import type { CityFiscalSnapshot } from "@/lib/city-fiscal-data";
import type { CityMetricsSnapshot } from "@/lib/city-metrics-data";
import { CitySimWeekBanner } from "@/components/city-sim-week-banner";
import type { CitySimWeekStatus } from "@/lib/city-sim-week";
import { isLegislationDraftOpen, isOrdinanceProposeOpen } from "@/lib/city-sim-week";
import type { OfficeSalaryAccrual } from "@/components/office-salary-collect-panel";

function TabLoading({ label }: { label: string }) {
  return (
    <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-10 text-center text-sm text-[var(--psc-muted)]">
      Loading {label}…
    </div>
  );
}

const CouncilBudgetDashboard = dynamic(
  () => import("@/components/council-budget-dashboard").then((m) => m.CouncilBudgetDashboard),
  { loading: () => <TabLoading label="budget" /> },
);
const CouncilLegislationPanel = dynamic(
  () => import("@/components/council-legislation-panel").then((m) => m.CouncilLegislationPanel),
  { loading: () => <TabLoading label="legislation" /> },
);
const CityMetricsDashboard = dynamic(
  () => import("@/components/city-metrics-dashboard").then((m) => m.CityMetricsDashboard),
  { loading: () => <TabLoading label="overview" /> },
);
const NycCouncilDistrictsPanel = dynamic(
  () => import("@/components/nyc-council-districts-panel").then((m) => m.NycCouncilDistrictsPanel),
  { loading: () => <TabLoading label="district map" /> },
);
const CityPoliciesPanel = dynamic(
  () => import("@/components/city-policies-panel").then((m) => m.CityPoliciesPanel),
  { loading: () => <TabLoading label="policies" /> },
);

type TabId = "overview" | "legislation" | "ordinances" | "budget";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "legislation", label: "Create legislation" },
  { id: "ordinances", label: "Policies" },
  { id: "budget", label: "Budget" },
];

function partyPill(party: string | null) {
  if (party === "democrat") return "bg-blue-100 text-blue-900 border-blue-300";
  if (party === "republican") return "bg-red-100 text-red-900 border-red-300";
  return "bg-slate-100 text-slate-800 border-slate-300";
}

function CouncilMemberCard({ member }: { member: CouncilRosterMember }) {
  const href = member.holderId ? profilePath(member.holderId) : null;
  const inner = (
    <>
      <div className="aspect-square w-full overflow-hidden rounded bg-[var(--psc-canvas)]">
        <ProfileImageWithFallback
          src={member.faceClaimUrl}
          name={member.holderName}
          variant="portrait"
          initialClassName="flex h-full w-full items-center justify-center text-xl font-semibold text-[var(--psc-muted)]"
        />
      </div>
      <div className="mt-2 space-y-1">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          {member.wardCode} · {member.borough}
        </p>
        <p className="text-sm font-semibold leading-tight text-[var(--psc-ink)]">{member.holderName}</p>
        <p className="text-xs text-[var(--psc-muted)]">{member.districtName}</p>
        <div className="flex flex-wrap gap-1 pt-0.5">
          <span className="rounded border px-1.5 py-0.5 text-[10px] font-semibold">{member.pviLabel}</span>
          {member.holderParty ? (
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold capitalize ${partyPill(member.holderParty)}`}
            >
              {member.holderParty}
            </span>
          ) : null}
          {member.isPlayerHeld ? (
            <span className="rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-900">
              Player
            </span>
          ) : null}
        </div>
      </div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-3 transition hover:border-[var(--psc-accent)]"
      >
        {inner}
      </Link>
    );
  }

  return (
    <article className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-3">{inner}</article>
  );
}

export function CouncilPageShell({
  data,
  fiscal,
  metrics,
  simWeek,
  isAdmin,
  officeSalaryAccrual = null,
}: {
  data: CityOfficeData;
  fiscal: CityFiscalSnapshot;
  metrics: CityMetricsSnapshot;
  simWeek: CitySimWeekStatus;
  isAdmin: boolean;
  officeSalaryAccrual?: OfficeSalaryAccrual | null;
}) {
  const canCouncil = data.isCouncilMember || isAdmin;
  const hasLegislationRole = data.isCouncilMember || data.isMayor || isAdmin;
  const canDraftLegislation = hasLegislationRole && isLegislationDraftOpen(simWeek);
  const canSubmitOrdinance = hasLegislationRole && isOrdinanceProposeOpen(simWeek);
  const legislationBlockedReason =
    !canSubmitOrdinance && isLegislationDraftOpen(simWeek)
      ? simWeek.budgetPassed || simWeek.budgetEnacted
        ? null
        : "Pass the biennium budget through council before proposing ordinances — use the Budget tab."
      : !isLegislationDraftOpen(simWeek)
        ? "Ordinances open during the legislative window (after election season)."
        : null;
  const defaultTab: TabId =
    simWeek.cyclePhase === "legislative"
      ? simWeek.budgetPassed || simWeek.budgetEnacted
        ? "legislation"
        : "budget"
      : "overview";
  const [tab, setTab] = useState<TabId>(defaultTab);

  return (
    <div className="space-y-6">
      <CitySimWeekBanner status={simWeek} />
      <nav className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? "rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white"
                : "rounded border border-[var(--psc-border)] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)] hover:border-[var(--psc-accent)]"
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="space-y-6">
          <CityMetricsDashboard metrics={metrics} fiscal={fiscal} isAdmin={isAdmin} />

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Council roster</h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {data.councilRoster.map((m) => (
                <li key={m.wardCode}>
                  <CouncilMemberCard member={m} />
                </li>
              ))}
            </ul>
          </section>

          <NycCouncilDistrictsPanel
            title="District map"
            districts={data.wardDistricts}
            showPortraits
          />
        </div>
      ) : null}

      {tab === "budget" ? (
        <CouncilBudgetDashboard
          key={fiscal.updatedAt}
          fiscal={fiscal}
          officeData={data}
          isAdmin={isAdmin}
          simWeek={simWeek}
          officeSalaryAccrual={officeSalaryAccrual}
        />
      ) : null}

      {tab === "legislation" ? (
        <CouncilLegislationPanel
          canPropose={canDraftLegislation}
          proposeSubmitEnabled={canSubmitOrdinance}
          canVote={canCouncil && simWeek.ordinancesAllowed}
          legislationBlockedReason={legislationBlockedReason}
          awaitingMayorOrdinances={data.awaitingMayorOrdinances}
          pendingProposals={data.pendingOrdinances}
          recentProposals={data.recentOrdinances}
        />
      ) : null}

      {tab === "ordinances" ? <CityPoliciesPanel ordinances={data.enactedOrdinances} /> : null}
    </div>
  );
}