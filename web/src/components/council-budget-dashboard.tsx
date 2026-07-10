"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import {
  proposeCityBudget,
  updateFiscalProposal,
  type MayorActionResult,
} from "@/app/actions/mayor";
import type { CityOfficeData } from "@/lib/city-office-data";
import {
  CITY_FISCAL_DEPARTMENT_KEYS,
  cityFiscalDepartmentLabel,
  computeCityFiscalTotals,
  departmentAllocationsRecord,
  formatBudgetMillions,
  formatPopulation,
  type CityFiscalDepartmentKey,
  type CityFiscalSnapshot,
} from "@/lib/city-fiscal-data";
import {
  allocationMillionsFromGdpSharePercent,
  budgetsMisalignedWithRevenue,
  defaultPlayerBudgetAllocationsFromGdp,
  deptMinimumGdpSharePercent,
  deptMinimumMillionsFromGdp,
  deptMaxGdpSharePercent,
  gdpSharePercentFromAllocationMillions,
  playerBudgetShareStepPercent,
  snapAllocationToGdpShareGrid,
  snapSharePercent,
} from "@/lib/city-player-budget";
import { NYC_CITY_NAME } from "@/lib/city";
import { isBudgetProposeOpen, type CitySimWeekStatus } from "@/lib/city-sim-week";
import {
  projectedBiennialCityGdpUsd,
} from "@/lib/city-office-salary-tax";
import { CouncilBudgetPanel } from "@/components/council-budget-panel";
import { CityHealthStrip } from "@/components/city-health-strip";
import { BudgetEffectPreview } from "@/components/budget-effect-preview";
import {
  OfficeSalaryCollectPanel,
  type OfficeSalaryAccrual,
} from "@/components/office-salary-collect-panel";

const DEFAULT_FLAT_TAX_PCT = 3;
const DEFAULT_PROGRESSIVE_BRACKETS = { low: 2, mid: 3.5, high: 4.5 } as const;

function MetricPill({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-green-800"
      : tone === "negative"
        ? "text-red-800"
        : "text-[var(--psc-ink)]";

  return (
    <div className="px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function ShareSlider({
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const step = playerBudgetShareStepPercent();
  const minPct = snapSharePercent(min, min, max);
  const markerPct = max > min ? ((minPct - min) / (max - min)) * 100 : 0;

  return (
    <div className="relative flex-1 pt-2">
      {max > min ? (
        <div
          className="pointer-events-none absolute top-0 h-1.5 w-px -translate-x-1/2 bg-amber-600"
          style={{ left: `${markerPct}%` }}
          title={`Minimum ${minPct.toFixed(1)}%`}
          aria-hidden
        />
      ) : null}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--psc-accent)] disabled:opacity-50"
        aria-label="Department share of city GDP"
      />
    </div>
  );
}

function DeptShareRow({
  label,
  headName,
  sharePct,
  minPct,
  maxPct,
  amountMillions,
  floorMillions,
  belowMinimum,
  disabled,
  onShareChange,
}: {
  label: string;
  headName?: string | null;
  sharePct: number;
  minPct: number;
  maxPct: number;
  amountMillions: number;
  floorMillions: number;
  belowMinimum: boolean;
  disabled?: boolean;
  onShareChange: (pct: number) => void;
}) {
  return (
    <div
      className={`grid grid-cols-[minmax(0,6.5rem)_1fr_3.25rem_3.25rem_3.25rem] items-center gap-x-2 gap-y-0.5 border-b py-2 last:border-b-0 ${
        belowMinimum
          ? "border-red-300/80 bg-red-50/50"
          : "border-[var(--psc-border)]/60"
      }`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[var(--psc-ink)]">{label}</p>
        {headName ? (
          <p className="truncate text-[10px] text-[var(--psc-muted)]">{headName}</p>
        ) : null}
      </div>
      <ShareSlider
        value={sharePct}
        min={minPct}
        max={maxPct}
        disabled={disabled}
        onChange={onShareChange}
      />
      <span
        className="text-right font-mono text-[10px] tabular-nums text-amber-900"
        title="Statutory floor (75% of default share × GDP)"
      >
        {formatBudgetMillions(floorMillions)}
      </span>
      <span className="text-right font-mono text-xs tabular-nums text-[var(--psc-ink)]">
        {formatBudgetMillions(amountMillions)}
      </span>
      <span className="text-right font-mono text-xs tabular-nums text-[var(--psc-muted)]">
        {sharePct.toFixed(1)}%
      </span>
    </div>
  );
}

function Panel({
  title,
  total,
  children,
  action,
}: {
  title: string;
  total: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--psc-border)] px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)]">{title}</h3>
        <div className="flex items-center gap-2">
          {action}
          <span className="font-mono text-sm font-semibold tabular-nums text-[var(--psc-ink)]">{total}</span>
        </div>
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function normalizePlayerBudgetDraft(
  fiscal: CityFiscalSnapshot,
  totals: ReturnType<typeof computeCityFiscalTotals>,
  biennialGdpUsd: number,
): CityFiscalSnapshot {
  if (totals.revenueSource !== "player" || biennialGdpUsd <= 0) return fiscal;

  const needsRealign = budgetsMisalignedWithRevenue(
    totals.totalExpenditureMillions,
    totals.totalRevenueMillions,
  );

  const shares = needsRealign
    ? defaultPlayerBudgetAllocationsFromGdp(biennialGdpUsd)
    : (Object.fromEntries(
        fiscal.departments.map((d) => [d.departmentKey, d.amountMillions]),
      ) as Record<CityFiscalDepartmentKey, number>);

  return {
    ...fiscal,
    departments: fiscal.departments.map((d) => ({
      ...d,
      amountMillions: snapAllocationToGdpShareGrid(shares[d.departmentKey], biennialGdpUsd, d.departmentKey),
    })),
  };
}

function fiscalDraftFromSnapshot(
  fiscal: CityFiscalSnapshot,
  totals: ReturnType<typeof computeCityFiscalTotals>,
  biennialGdpUsd: number,
): CityFiscalSnapshot {
  const { revenueBreakdown: _cached, ...draftBase } = normalizePlayerBudgetDraft(
    fiscal,
    totals,
    biennialGdpUsd,
  );
  return draftBase;
}

export function CouncilBudgetDashboard({
  fiscal,
  officeData,
  isAdmin,
  simWeek,
  officeSalaryAccrual = null,
}: {
  fiscal: CityFiscalSnapshot;
  officeData: CityOfficeData;
  isAdmin: boolean;
  simWeek: CitySimWeekStatus;
  officeSalaryAccrual?: OfficeSalaryAccrual | null;
}) {
  const router = useRouter();
  const canEdit = officeData.isMayor || isAdmin;
  const initialTotals = useMemo(() => computeCityFiscalTotals(fiscal), [fiscal]);
  const initialBiennialGdp = fiscal.officeSalaryBase
    ? projectedBiennialCityGdpUsd(fiscal.officeSalaryBase)
    : 0;
  const [draft, setDraft] = useState(() =>
    fiscalDraftFromSnapshot(fiscal, initialTotals, initialBiennialGdp),
  );
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<MayorActionResult | null>(null);

  useEffect(() => {
    const totals = computeCityFiscalTotals(fiscal);
    const biennialGdp = fiscal.officeSalaryBase
      ? projectedBiennialCityGdpUsd(fiscal.officeSalaryBase)
      : 0;
    setDraft(fiscalDraftFromSnapshot(fiscal, totals, biennialGdp));
  }, [fiscal]);

  const totals = useMemo(() => computeCityFiscalTotals(draft), [draft]);
  const revenueSource = totals.revenueSource;
  const officeSalaryBase = draft.officeSalaryBase ?? fiscal.officeSalaryBase;
  const biennialGdpUsd = officeSalaryBase ? projectedBiennialCityGdpUsd(officeSalaryBase) : 0;
  const deptRecord = useMemo(() => departmentAllocationsRecord(draft.departments), [draft.departments]);
  const usesOfficeSalaryTax = revenueSource === "player" && Boolean(officeSalaryBase);
  const totalSpendPctOfGdp =
    biennialGdpUsd > 0
      ? (totals.totalExpenditureMillions / (biennialGdpUsd / 1_000_000)) * 100
      : 0;

  const surplusTone =
    totals.annualSurplusDeficitMillions > 0
      ? "positive"
      : totals.annualSurplusDeficitMillions < 0
        ? "negative"
        : "neutral";

  function run(fn: () => Promise<MayorActionResult>) {
    start(async () => {
      const result = await fn();
      setFlash(result);
      if (result.ok) router.refresh();
    });
  }

  function setDeptGdpShare(key: CityFiscalDepartmentKey, sharePct: number) {
    if (biennialGdpUsd <= 0) return;
    const snapped = snapSharePercent(
      sharePct,
      deptMinimumGdpSharePercent(key),
      deptMaxGdpSharePercent(key),
    );
    const amount = allocationMillionsFromGdpSharePercent(snapped, biennialGdpUsd);
    setDraft((prev) => ({
      ...prev,
      departments: prev.departments.map((d) =>
        d.departmentKey === key ? { ...d, amountMillions: amount } : d,
      ),
    }));
  }

  function resetDeptAllocations() {
    if (biennialGdpUsd <= 0) return;
    const shares = defaultPlayerBudgetAllocationsFromGdp(biennialGdpUsd);
    setDraft((prev) => ({
      ...prev,
      departments: prev.departments.map((d) => ({
        ...d,
        amountMillions: shares[d.departmentKey],
      })),
    }));
  }

  function setFlatTaxRate(rate: number) {
    setDraft((d) => ({
      ...d,
      incomeTaxMidPct: rate,
      incomeTaxLowPct: rate,
      incomeTaxHighPct: rate,
    }));
  }

  function toggleIncomeTaxEnabled(enabled: boolean) {
    setDraft((d) => {
      const needsDefaults =
        enabled && d.incomeTaxMidPct <= 0 && d.incomeTaxLowPct <= 0 && d.incomeTaxHighPct <= 0;
      return {
        ...d,
        incomeTaxEnabled: enabled,
        ...(needsDefaults
          ? d.incomeTaxFlat
            ? {
                incomeTaxLowPct: DEFAULT_FLAT_TAX_PCT,
                incomeTaxMidPct: DEFAULT_FLAT_TAX_PCT,
                incomeTaxHighPct: DEFAULT_FLAT_TAX_PCT,
              }
            : DEFAULT_PROGRESSIVE_BRACKETS
          : {}),
      };
    });
  }

  function saveDraft() {
    run(() =>
      updateFiscalProposal({
        propertyTaxRatePct: 0,
        businessTaxRatePct: 0,
        incomeTaxEnabled: draft.incomeTaxEnabled,
        incomeTaxFlat: draft.incomeTaxFlat,
        incomeTaxLowPct: draft.incomeTaxLowPct,
        incomeTaxMidPct: draft.incomeTaxMidPct,
        incomeTaxHighPct: draft.incomeTaxHighPct,
        finance: deptRecord.finance,
        police: deptRecord.police,
        publicWorks: deptRecord.public_works,
        parks: deptRecord.parks,
        planning: deptRecord.planning,
      }),
    );
  }

  function buildSubmitConfirmMessage(): string {
    const balance = totals.annualSurplusDeficitMillions;
    const lines = [
      "Submit this 2-year biennium budget to the council?",
      "",
      `Revenue: ${formatBudgetMillions(totals.totalRevenueMillions)}`,
      `Spending: ${formatBudgetMillions(totals.totalExpenditureMillions)}`,
      `Biennial balance: ${formatBudgetMillions(balance)}`,
      `Treasury after enactment: ${formatBudgetMillions(totals.projectedTreasuryMillions)}`,
    ];
    if (balance < 0) {
      lines.push("", "This budget runs a deficit — the city will take on debt.");
    } else if (balance > 0) {
      lines.push("", "This budget runs a surplus — treasury will grow if enacted.");
    }
    return lines.join("\n");
  }

  function submitBudgetProposal() {
    if (officeData.pendingBudget || officeData.awaitingMayorBudget || officeData.proposedBudget) return;
    if (!window.confirm(buildSubmitConfirmMessage())) return;
    run(() =>
      proposeCityBudget({
        finance: deptRecord.finance,
        police: deptRecord.police,
        publicWorks: deptRecord.public_works,
        parks: deptRecord.parks,
        planning: deptRecord.planning,
      }),
    );
  }

  const submitWarning =
    totals.annualSurplusDeficitMillions < 0
      ? totals.revenueSource === "player" &&
        totals.totalRevenueMillions > 0 &&
        totals.annualSurplusDeficitMillions < -(totals.totalRevenueMillions * 0.5)
        ? `This budget projects a ${formatBudgetMillions(totals.annualSurplusDeficitMillions)} deficit — more than half of collectible revenue. You can still submit; the council will vote on it.`
        : `This budget projects a ${formatBudgetMillions(totals.annualSurplusDeficitMillions)} biennial deficit. Treasury would fall to ${formatBudgetMillions(totals.projectedTreasuryMillions)} after enactment.`
      : totals.annualSurplusDeficitMillions > 0
        ? `This budget projects a ${formatBudgetMillions(totals.annualSurplusDeficitMillions)} biennial surplus. Treasury would rise to ${formatBudgetMillions(totals.projectedTreasuryMillions)} after enactment.`
        : null;

  const pipelineBlocked = Boolean(
    officeData.pendingBudget ||
      officeData.awaitingMayorBudget ||
      officeData.proposedBudget,
  );
  const budgetProposeOpen = isBudgetProposeOpen(simWeek);
  const proposeBlocked = !budgetProposeOpen;

  function budgetProposeBlockedMessage(): string | null {
    if (budgetProposeOpen) return null;
    if (officeData.awaitingMayorBudget) {
      return "This biennium budget passed council — sign it on the Mayor's Office page before filing another.";
    }
    if (simWeek.budgetEnacted) {
      const enacted = officeData.enactedBudgets.find((b) => b.fiscalYear === simWeek.bienniumIndex);
      return enacted
        ? `Biennium ${simWeek.bienniumIndex} budget is already enacted (FY${enacted.fiscalYear}). File ordinances on the Create legislation tab.`
        : `Biennium ${simWeek.bienniumIndex} budget is already enacted. File ordinances on the Create legislation tab.`;
    }
    if (pipelineBlocked) {
      return "A budget is already in the council or mayor pipeline for this biennium.";
    }
    if (simWeek.cyclePhase !== "legislative") {
      return "Budget proposals open at biennium sign-ups or during the legislative session.";
    }
    return "Budget proposal window is closed for this biennium.";
  }

  return (
    <div className="space-y-4">
      <CityHealthStrip fiscal={fiscal} projectedTreasuryMillions={totals.projectedTreasuryMillions} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">City budget · {NYC_CITY_NAME}</h2>
        {canEdit && usesOfficeSalaryTax ? (
          <button
            type="button"
            disabled={pending || biennialGdpUsd <= 0}
            onClick={resetDeptAllocations}
            className="rounded border border-[var(--psc-border)] px-2.5 py-1 text-xs font-semibold text-[var(--psc-ink)] disabled:opacity-50"
          >
            Reset dept. shares
          </button>
        ) : null}
      </div>

      {officeData.pendingBudget ? (
        <p className="rounded-md border border-amber-400/50 bg-amber-50/80 px-3 py-2 text-sm text-amber-950">
          FY{officeData.pendingBudget.fiscalYear} budget before council — vote below if you hold a seat.
        </p>
      ) : null}

      {officeData.awaitingMayorBudget ? (
        <p className="rounded-md border border-violet-400/50 bg-violet-50/80 px-3 py-2 text-sm text-violet-950">
          FY{officeData.awaitingMayorBudget.fiscalYear} passed council {officeData.awaitingMayorBudget.councilYeas}–
          {officeData.awaitingMayorBudget.councilNays} — awaiting mayor signature.
        </p>
      ) : null}

      {flash ? (
        <p
          className={`rounded-md border px-3 py-2 text-sm ${
            flash.ok ? "border-green-700/30 bg-green-50 text-green-900" : "border-red-700/30 bg-red-50 text-red-900"
          }`}
        >
          {flash.message}
        </p>
      ) : null}

      <div className="grid divide-y divide-[var(--psc-border)] overflow-hidden rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        <MetricPill label="Revenue" value={formatBudgetMillions(totals.totalRevenueMillions)} />
        <MetricPill label="Spending" value={formatBudgetMillions(totals.totalExpenditureMillions)} />
        <MetricPill
          label="Surplus / deficit"
          value={formatBudgetMillions(totals.annualSurplusDeficitMillions)}
          tone={surplusTone}
        />
        <MetricPill
          label="Treasury after budget"
          value={formatBudgetMillions(totals.projectedTreasuryMillions)}
          tone={surplusTone}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Revenue" total={formatBudgetMillions(totals.totalRevenueMillions)}>
          {usesOfficeSalaryTax ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-[var(--psc-ink)]">Income tax</span>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setDraft((d) => ({ ...d, incomeTaxFlat: true }))}
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                    draft.incomeTaxFlat ? "bg-[var(--psc-ink)] text-white" : "border border-[var(--psc-border)]"
                  }`}
                >
                  Flat
                </button>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setDraft((d) => ({ ...d, incomeTaxFlat: false }))}
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                    !draft.incomeTaxFlat ? "bg-[var(--psc-ink)] text-white" : "border border-[var(--psc-border)]"
                  }`}
                >
                  Progressive
                </button>
                <button
                  type="button"
                  disabled={!canEdit}
                  role="switch"
                  aria-checked={draft.incomeTaxEnabled}
                  aria-label="Enable income tax"
                  onClick={() => toggleIncomeTaxEnabled(!draft.incomeTaxEnabled)}
                  className={`relative ml-auto h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${
                    draft.incomeTaxEnabled ? "bg-[var(--psc-accent)]" : "bg-[var(--psc-border)]"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow transition ${
                      draft.incomeTaxEnabled ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>

              {draft.incomeTaxFlat ? (
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={12}
                    step={0.1}
                    value={draft.incomeTaxMidPct}
                    disabled={!canEdit || !draft.incomeTaxEnabled}
                    onChange={(e) => setFlatTaxRate(Number(e.target.value))}
                    className="flex-1 accent-[var(--psc-accent)] disabled:opacity-50"
                  />
                  <span className="w-14 text-right font-mono text-sm tabular-nums">
                    {draft.incomeTaxMidPct.toFixed(1)}%
                  </span>
                  <span className="w-16 text-right font-mono text-sm font-semibold tabular-nums">
                    {formatBudgetMillions(totals.wageIncomeTaxRevenueMillions)}
                  </span>
                </div>
              ) : (
                <div className="space-y-2">
                  {(
                    [
                      ["≤ $50k", "incomeTaxLowPct", 8],
                      ["$50k–$150k", "incomeTaxMidPct", 10],
                      ["> $150k", "incomeTaxHighPct", 12],
                    ] as const
                  ).map(([label, field, max]) => (
                    <div key={field} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-[10px] text-[var(--psc-muted)]">{label}</span>
                      <input
                        type="range"
                        min={0}
                        max={max}
                        step={0.1}
                        value={draft[field]}
                        disabled={!canEdit || !draft.incomeTaxEnabled}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [field]: Number(e.target.value) }))
                        }
                        className="flex-1 accent-[var(--psc-accent)] disabled:opacity-50"
                      />
                      <span className="w-14 text-right font-mono text-xs tabular-nums">
                        {draft[field].toFixed(1)}%
                      </span>
                    </div>
                  ))}
                  <p className="text-right font-mono text-sm font-semibold tabular-nums">
                    {formatBudgetMillions(totals.wageIncomeTaxRevenueMillions)}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2 text-sm text-[var(--psc-muted)]">
              <p>Population {formatPopulation(draft.population)} · economy {draft.economyIndex.toFixed(1)}</p>
              <p>Macro fallback — no seated player officeholders.</p>
            </div>
          )}
        </Panel>

        <Panel
          title="Departments"
          total={formatBudgetMillions(totals.totalExpenditureMillions)}
          action={
            <span className="text-[10px] text-[var(--psc-muted)]">
              {totalSpendPctOfGdp.toFixed(0)}% of GDP
            </span>
          }
        >
          {revenueSource === "player" && biennialGdpUsd > 0 ? (
            <>
              <div className="mb-1 grid grid-cols-[minmax(0,6.5rem)_1fr_3.25rem_3.25rem_3.25rem] gap-x-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                <span>Dept</span>
                <span>% of GDP</span>
                <span className="text-right text-amber-800">Floor</span>
                <span className="text-right">Alloc</span>
                <span className="text-right">%</span>
              </div>
              {CITY_FISCAL_DEPARTMENT_KEYS.map((key) => {
                const head = officeData.departments.find((d) => d.departmentKey === key);
                const allocation = deptRecord[key];
                const floorMillions = deptMinimumMillionsFromGdp(key, biennialGdpUsd);
                const sharePct = gdpSharePercentFromAllocationMillions(allocation, biennialGdpUsd);
                const minPct = snapSharePercent(
                  deptMinimumGdpSharePercent(key),
                  deptMinimumGdpSharePercent(key),
                  deptMaxGdpSharePercent(key),
                );
                const maxPct = snapSharePercent(
                  deptMaxGdpSharePercent(key),
                  deptMinimumGdpSharePercent(key),
                  deptMaxGdpSharePercent(key),
                );

                return (
                  <DeptShareRow
                    key={key}
                    label={cityFiscalDepartmentLabel(key)}
                    headName={head?.politicianName}
                    sharePct={snapSharePercent(sharePct, minPct, maxPct)}
                    minPct={minPct}
                    maxPct={maxPct}
                    amountMillions={allocation}
                    floorMillions={floorMillions}
                    belowMinimum={allocation < floorMillions - 0.000_001}
                    disabled={!canEdit}
                    onShareChange={(pct) => setDeptGdpShare(key, pct)}
                  />
                );
              })}
            </>
          ) : (
            <p className="text-sm text-[var(--psc-muted)]">Seat officeholders to set GDP-based floors.</p>
          )}
        </Panel>
      </div>

      <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Proposal preview</p>
            <dl className="grid gap-1 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-[var(--psc-muted)]">Revenue</dt>
                <dd className="font-mono tabular-nums text-[var(--psc-ink)]">
                  {formatBudgetMillions(totals.totalRevenueMillions)}
                </dd>
              </div>
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-[var(--psc-muted)]">Spending</dt>
                <dd className="font-mono tabular-nums text-[var(--psc-ink)]">
                  {formatBudgetMillions(totals.totalExpenditureMillions)}
                </dd>
              </div>
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-[var(--psc-muted)]">Biennial balance</dt>
                <dd
                  className={`font-mono tabular-nums ${
                    surplusTone === "negative"
                      ? "text-red-800"
                      : surplusTone === "positive"
                        ? "text-green-800"
                        : "text-[var(--psc-ink)]"
                  }`}
                >
                  {formatBudgetMillions(totals.annualSurplusDeficitMillions)}
                </dd>
              </div>
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-[var(--psc-muted)]">Treasury after enactment</dt>
                <dd
                  className={`font-mono tabular-nums ${
                    surplusTone === "negative"
                      ? "text-red-800"
                      : surplusTone === "positive"
                        ? "text-green-800"
                        : "text-[var(--psc-ink)]"
                  }`}
                >
                  {formatBudgetMillions(totals.projectedTreasuryMillions)}
                </dd>
              </div>
            </dl>
          </div>

          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={saveDraft}
                className="rounded border border-[var(--psc-border)] bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                Save draft
              </button>
              <button
                type="button"
                disabled={pending || pipelineBlocked || proposeBlocked}
                onClick={submitBudgetProposal}
                className="rounded bg-[var(--psc-accent)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Submit proposal
              </button>
            </div>
          ) : (
            <p className="text-xs text-[var(--psc-muted)]">
              {budgetProposeOpen && !pipelineBlocked
                ? "Only the mayor can submit the biennial budget. Once it is filed, cast your council vote in the panel below."
                : "Mayor-only editing."}
            </p>
          )}
        </div>

        {submitWarning ? (
          <p
            className={`rounded-md border px-3 py-2 text-xs ${
              totals.annualSurplusDeficitMillions < 0
                ? "border-amber-400/60 bg-amber-50/90 text-amber-950"
                : "border-green-400/50 bg-green-50/80 text-green-900"
            }`}
          >
            {submitWarning}
          </p>
        ) : null}

        {pipelineBlocked ? (
          <p className="text-xs text-[var(--psc-muted)]">
            A budget is already in the council or mayor pipeline — wait for that cycle to finish before filing another.
          </p>
        ) : proposeBlocked ? (
          <p className="rounded-md border border-violet-400/50 bg-violet-50/80 px-3 py-2 text-xs text-violet-950">
            {budgetProposeBlockedMessage()}
          </p>
        ) : null}

        <BudgetEffectPreview
          departments={draft.departments}
          deficitMillions={totals.annualSurplusDeficitMillions}
        />
      </section>

      {officeSalaryAccrual?.roleKey ? (
        <OfficeSalaryCollectPanel accrual={officeSalaryAccrual} />
      ) : null}

      <CouncilBudgetPanel data={officeData} isAdmin={isAdmin} />
    </div>
  );
}
