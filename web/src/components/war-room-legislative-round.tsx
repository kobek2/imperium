"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import {
  advanceLegislativeRound,
  assignAllCaucus,
  bribeNpc,
  lobbyMayor,
  nominateLeadership,
  proposeRoundBill,
  startLegislativeRound,
  whipNpc,
  type CampaignActionResult,
} from "@/app/actions/campaign-manager";
import type { CaucusMemberRow, LegislativeRoundBundle, RollCallRow, RoundBillRow } from "@/lib/legislative-round-data";
import {
  describeRoundBill,
  issueDisplayName,
  pickFeaturedIssues,
  spectrumPct,
  stanceLabelForBill,
  stanceSpectrumLabel,
  type BillTemplateDefinition,
  type BillTemplateStance,
} from "@/lib/campaign-round-bill-templates";
import { phaseLabel } from "@/lib/legislative-round-data";

const LEADERSHIP_ROLES = [
  { key: "council_spokesperson", label: "Council Spokesperson", desc: "Elected by all 7 members — NPCs vote party line" },
] as const;

const ROUND_PHASES = [
  { key: "leadership", label: "Spokesperson", short: "1" },
  { key: "proposals", label: "Ordinances", short: "2" },
  { key: "council_vote", label: "Council", short: "3" },
  { key: "mayoral", label: "Mayor", short: "4" },
  { key: "completed", label: "Result", short: "✓" },
] as const;

function partyShort(party: string): string {
  return party === "democrat" ? "D" : party === "republican" ? "R" : party.slice(0, 1).toUpperCase();
}

function partyName(party: string): string {
  return party === "democrat" ? "Democrat" : party === "republican" ? "Republican" : party;
}

function phaseIndex(phase: string | null): number {
  if (!phase) return -1;
  return ROUND_PHASES.findIndex((p) => p.key === phase);
}

function formatMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function CapitalBar({ value, max, color }: { value: number; max: number; color: "blue" | "red" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fill = color === "blue" ? "bg-blue-600" : "bg-red-600";
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[var(--psc-border)]/50">
      <div className={`h-full rounded-full ${fill} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function PhaseStepper({ currentPhase }: { currentPhase: string | null }) {
  const idx = phaseIndex(currentPhase);
  return (
    <ol className="flex items-center gap-0 overflow-x-auto pb-1">
      {ROUND_PHASES.map((p, i) => {
        const done = idx > i;
        const active = idx === i;
        return (
          <li key={p.key} className="flex min-w-0 flex-1 items-center">
            <div className="flex min-w-0 flex-col items-center gap-1">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                  active
                    ? "border-[var(--psc-seal)] bg-[var(--psc-seal)] text-white"
                    : done
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-[var(--psc-border)] bg-[var(--psc-canvas)] text-[var(--psc-muted)]"
                }`}
              >
                {done ? "✓" : p.short}
              </span>
              <span
                className={`hidden truncate text-[9px] font-semibold uppercase tracking-wide sm:block ${
                  active ? "text-[var(--psc-seal)]" : done ? "text-emerald-700" : "text-[var(--psc-muted)]"
                }`}
              >
                {p.label}
              </span>
            </div>
            {i < ROUND_PHASES.length - 1 ? (
              <div className={`mx-1 h-px min-w-[12px] flex-1 ${done ? "bg-emerald-500" : "bg-[var(--psc-border)]"}`} aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ActionChip({ children, tone = "neutral" }: { children: ReactNode; tone?: "cost" | "reward" | "neutral" | "danger" }) {
  const tones = {
    cost: "border-amber-300 bg-amber-50 text-amber-900",
    reward: "border-emerald-300 bg-emerald-50 text-emerald-800",
    danger: "border-red-300 bg-red-50 text-red-800",
    neutral: "border-[var(--psc-border)] bg-[var(--psc-canvas)] text-[var(--psc-muted)]",
  };
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

function PoliticianCard({
  member,
  humanParty,
  selected,
  onSelect,
  selectable,
  showLoyalty,
}: {
  member: CaucusMemberRow;
  humanParty: string;
  selected?: boolean;
  onSelect?: () => void;
  selectable?: boolean;
  showLoyalty?: boolean;
}) {
  const isAlly = member.party === humanParty;
  const capPct = Math.min(100, member.politicalCapital * 4);
  const loyaltyPct = member.whipLoyalty;

  return (
    <button
      type="button"
      disabled={!selectable}
      onClick={onSelect}
      className={`relative w-full rounded border text-left transition-colors ${
        selectable ? "cursor-pointer hover:border-[var(--psc-accent)]/40" : "cursor-default"
      } ${
        selected
          ? "border-[var(--psc-seal)] bg-[var(--psc-canvas)] ring-1 ring-[var(--psc-seal)]/30"
          : isAlly
            ? "border-blue-200 bg-blue-50/50"
            : "border-red-200 bg-red-50/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2 p-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
                isAlly ? "bg-blue-600 text-white" : "bg-red-600 text-white"
              }`}
            >
              {partyShort(member.party)}
            </span>
            <span className="truncate text-xs font-semibold text-[var(--psc-ink)]">{member.name}</span>
          </div>
          <p className="mt-0.5 truncate text-[10px] text-[var(--psc-muted)]">
            Council · {member.seatLabel}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--psc-muted)]">Cap</p>
          <p className="text-sm font-bold tabular-nums text-[var(--psc-ink)]">{member.politicalCapital}</p>
        </div>
      </div>
      <div className="space-y-1 px-2.5 pb-2.5">
        <div>
          <div className="mb-0.5 flex justify-between text-[9px] text-[var(--psc-muted)]">
            <span>Influence</span>
            <span>{capPct}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-[var(--psc-border)]/60">
            <div className={`h-full rounded-full ${isAlly ? "bg-blue-500" : "bg-red-500"}`} style={{ width: `${capPct}%` }} />
          </div>
        </div>
        {showLoyalty && !isAlly ? (
          <div>
            <div className="mb-0.5 flex justify-between text-[9px] text-[var(--psc-muted)]">
              <span>Loyalty</span>
              <span>{loyaltyPct}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-[var(--psc-border)]/60">
              <div
                className={`h-full rounded-full ${loyaltyPct > 85 ? "bg-red-500" : loyaltyPct > 60 ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${loyaltyPct}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>
      {selected ? (
        <div className="absolute right-1.5 top-1.5 rounded bg-[var(--psc-seal)] px-1.5 py-0.5 text-[9px] font-semibold text-white">
          Selected
        </div>
      ) : null}
    </button>
  );
}

function methodLabel(method: string): string {
  if (method === "assigned") return "Assigned";
  if (method === "convince") return "PAC";
  if (method === "caucus_line") return "Party line";
  if (method === "rival_whip") return "Rival whip";
  return method;
}

function RollCallPanel({
  title,
  rows,
  humanParty,
  passed,
}: {
  title: string;
  rows: RollCallRow[];
  humanParty: string;
  passed?: boolean;
}) {
  if (rows.length === 0) return null;
  const yeas = rows.filter((r) => r.vote === "yea").length;
  const nays = rows.filter((r) => r.vote === "nay").length;
  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-[var(--psc-ink)]">{title}</h4>
        <p className={`text-sm font-bold tabular-nums ${passed === false ? "text-red-700" : passed ? "text-emerald-700" : "text-[var(--psc-ink)]"}`}>
          {yeas} Yea · {nays} Nay {passed === true ? "· PASSED" : passed === false ? "· FAILED" : ""}
        </p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--psc-border)] text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
              <th className="py-1.5 pr-2">Member</th>
              <th className="py-1.5 pr-2">Party</th>
              <th className="py-1.5 pr-2">Vote</th>
              <th className="py-1.5">How</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.simPoliticianId} className="border-b border-[var(--psc-border)]/40">
                <td className="py-1.5 pr-2 font-medium text-[var(--psc-ink)]">{r.name}</td>
                <td className={`py-1.5 pr-2 ${r.party === humanParty ? "text-blue-700" : "text-red-700"}`}>
                  {partyShort(r.party)}
                </td>
                <td className={`py-1.5 pr-2 font-semibold uppercase ${r.vote === "yea" ? "text-emerald-700" : "text-red-700"}`}>
                  {r.vote}
                </td>
                <td className="py-1.5 text-[var(--psc-muted)]">{methodLabel(r.method)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StancePicker({
  template,
  selected,
  disabled,
  onSelect,
}: {
  template: BillTemplateDefinition;
  selected: BillTemplateStance | null;
  disabled?: boolean;
  onSelect: (stance: BillTemplateStance) => void;
}) {
  return (
    <div className="space-y-3">
      {template.stances.map((stance) => {
        const on = selected?.stance_key === stance.stance_key;
        const pct = spectrumPct(stance.policy_value);
        return (
          <button
            key={stance.stance_key}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(stance)}
            className={`w-full rounded border p-3 text-left transition-colors ${
              on ? "border-[var(--psc-seal)] bg-amber-50/70 ring-1 ring-[var(--psc-seal)]/20" : "border-[var(--psc-border)] bg-[var(--psc-panel)] hover:border-[var(--psc-accent)]/30"
            } ${disabled ? "opacity-60" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-[var(--psc-ink)]">{stance.label}</p>
                <p className="mt-0.5 text-xs text-[var(--psc-muted)]">{stance.summary}</p>
              </div>
              <span className="shrink-0 text-[10px] font-semibold uppercase text-[var(--psc-muted)]">
                {stanceSpectrumLabel(stance.policy_value)}
              </span>
            </div>
            <div className="mt-2">
              <div className="mb-1 flex justify-between text-[9px] text-[var(--psc-muted)]">
                <span>Conservative</span>
                <span>Liberal</span>
              </div>
              <div className="relative h-2 overflow-hidden rounded-full bg-gradient-to-r from-red-300 via-slate-200 to-blue-400">
                <div
                  className="absolute top-0 h-full w-1 -translate-x-1/2 rounded-full bg-[var(--psc-ink)]"
                  style={{ left: `${pct}%` }}
                />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function BillCard({
  bill,
  humanParty,
  active,
  hearingNow,
}: {
  bill: RoundBillRow;
  humanParty: string;
  active?: boolean;
  hearingNow?: boolean;
}) {
  const isOurs = bill.party === humanParty;
  const stanceLabel = stanceLabelForBill(bill);
  return (
    <div
      className={`relative w-full rounded border p-3 text-left ${
        hearingNow
          ? "border-amber-500 bg-amber-50/60 ring-1 ring-amber-400/40"
          : active
            ? "border-[var(--psc-seal)] bg-[var(--psc-canvas)]/60"
            : isOurs
              ? "border-blue-200 bg-[var(--psc-panel)]"
              : "border-red-200 bg-[var(--psc-panel)]"
      }`}
    >
      {hearingNow ? (
        <span className="absolute right-2 top-2 rounded bg-amber-600 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
          On floor
        </span>
      ) : null}
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${isOurs ? "text-blue-700" : "text-red-700"}`}>
        {isOurs ? "Your caucus" : "Rival caucus"} · docket #{bill.docketOrder}
      </p>
      <h4 className="mt-0.5 pr-16 text-sm font-semibold text-[var(--psc-ink)]">{bill.title}</h4>
      <p className="mt-1 line-clamp-2 text-xs text-[var(--psc-muted)]">{bill.summary}</p>
      {bill.issueKey ? (
        <ul className="mt-2 flex flex-wrap gap-1">
          <li className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-1.5 py-0.5 text-[9px] text-[var(--psc-muted)]">
            {issueDisplayName(bill.issueKey)}
          </li>
          {stanceLabel ? (
            <li className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-1.5 py-0.5 text-[9px] text-[var(--psc-muted)]">
              {stanceLabel}
            </li>
          ) : null}
        </ul>
      ) : null}
      <p className="mt-2 text-[10px] text-[var(--psc-muted)]">Sponsor: {bill.sponsorName}</p>
      {(bill.houseYeas > 0 || bill.senateYeas > 0) && (
        <div className="mt-2 flex gap-3 text-[10px] tabular-nums text-slate-400">
          {bill.houseYeas + bill.houseNays > 0 ? <span>Council {bill.houseYeas}-{bill.houseNays}</span> : null}
        </div>
      )}
      {bill.signed ? <p className="mt-1 text-[10px] font-semibold text-emerald-700">Signed into law</p> : null}
      {bill.vetoed ? <p className="mt-1 text-[10px] font-semibold text-red-700">Vetoed</p> : null}
    </div>
  );
}

function FlashBanner({ flash }: { flash: CampaignActionResult }) {
  return (
    <div
      role="status"
      className={`rounded border px-3 py-2 text-sm ${
        flash.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-800"
      }`}
    >
      {flash.message}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]">
      <div className="border-b border-[var(--psc-border)] px-4 py-3">
        <h4 className="text-sm font-semibold text-[var(--psc-ink)]">{title}</h4>
        {subtitle ? <p className="mt-0.5 text-xs text-[var(--psc-muted)]">{subtitle}</p> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

const inputClass =
  "mt-1 block w-full rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2 py-1.5 text-sm text-[var(--psc-ink)]";

const btnPrimary = "rounded bg-[var(--psc-seal)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

const btnSecondary =
  "rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-1.5 text-sm font-medium text-[var(--psc-ink)] hover:bg-[var(--psc-canvas)] disabled:opacity-50";

export function WarRoomLegislativeRound({
  bundle,
  congressWindow,
  isStrategist,
}: {
  bundle: LegislativeRoundBundle;
  congressWindow: boolean;
  isStrategist: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [nomPending, startNom] = useTransition();
  const [flash, setFlash] = useState<CampaignActionResult | null>(null);
  const [nomSim, setNomSim] = useState("");
  const [nomRole, setNomRole] = useState("council_spokesperson");
  const [sponsorSim, setSponsorSim] = useState("");
  const [selectedIssueKey, setSelectedIssueKey] = useState("");
  const [selectedStance, setSelectedStance] = useState<BillTemplateStance | null>(null);
  const [whipSim, setWhipSim] = useState("");
  const [whipVote, setWhipVote] = useState<"yea" | "nay">("yea");
  const [bribeSim, setBribeSim] = useState("");
  const [bribeAmount, setBribeAmount] = useState("500000");

  const { status, caucus, bills, leadership, rollCalls, voteAssignments, humanParty } = bundle;
  const rivalParty = humanParty === "democrat" ? "republican" : "democrat";
  const capMax = Math.max(status.myPoliticalCapital, status.rivalPoliticalCapital, 30);
  const featuredIssues = useMemo(
    () => pickFeaturedIssues(status.campaignCycle, status.campaignTurn, status.featuredIssueKeys),
    [status.campaignCycle, status.campaignTurn, status.featuredIssueKeys],
  );
  const selectedTemplate = useMemo(
    () => featuredIssues.find((t) => t.issue_key === selectedIssueKey) ?? featuredIssues[0],
    [featuredIssues, selectedIssueKey],
  );

  useEffect(() => {
    if (featuredIssues.length === 0) return;
    const first = featuredIssues[0];
    setSelectedIssueKey((prev) => prev || first.issue_key);
  }, [featuredIssues]);

  useEffect(() => {
    if (!selectedTemplate) return;
    const defaultStance = selectedTemplate.stances.find((s) => s.policy_value >= 1) ?? selectedTemplate.stances[0];
    setSelectedStance(defaultStance ?? null);
  }, [selectedTemplate]);

  const composedBill = useMemo(() => {
    if (!selectedTemplate || !selectedStance) return null;
    return describeRoundBill(selectedTemplate, selectedStance);
  }, [selectedTemplate, selectedStance]);

  const roleAvailable = (roleKey: string) => roleKey === "council_spokesperson";

  const councilCaucus = useMemo(() => caucus.filter((c) => c.chamber === "council"), [caucus]);
  const myCouncil = useMemo(() => councilCaucus.filter((c) => c.party === humanParty), [councilCaucus, humanParty]);
  const rivalCouncil = useMemo(() => councilCaucus.filter((c) => c.party !== humanParty), [councilCaucus, humanParty]);
  const voteCaucus = councilCaucus;
  const myVoteCaucus = useMemo(
    () => voteCaucus.filter((c) => c.party === humanParty),
    [voteCaucus, humanParty],
  );
  const rivalVoteCaucus = useMemo(
    () => voteCaucus.filter((c) => c.party !== humanParty),
    [voteCaucus, humanParty],
  );
  const assignmentBySim = useMemo(
    () => new Map(voteAssignments.map((a) => [a.simPoliticianId, a])),
    [voteAssignments],
  );

  function rollCallFor(billId: string, chamber: "house" | "senate" | "council" = "council") {
    return rollCalls.filter(
      (r) => r.billId === billId && (r.chamber === chamber || (chamber === "council" && r.chamber === "house")),
    );
  }

  function advanceLabel(): string {
    if (pending) return "Advancing…";
    if (status.roundPhase === "council_vote" || status.roundPhase === "house_vote") return "Call council vote →";
    if (status.roundPhase === "mayoral" || status.roundPhase === "presidential") return "Resolve mayor action →";
    return "Advance phase →";
  }

  const activeBill = bills.find((b) => b.id === status.activeBillId);

  function run(fn: () => Promise<CampaignActionResult>) {
    start(async () => {
      setFlash(null);
      const r = await fn();
      setFlash(r);
      if (r.ok) router.refresh();
    });
  }

  function runNom(fn: () => Promise<CampaignActionResult>) {
    startNom(async () => {
      setFlash(null);
      const r = await fn();
      setFlash(r);
      if (r.ok) router.refresh();
    });
  }

  if (!congressWindow) {
    return (
      <p className="rounded border border-dashed border-[var(--psc-border)] px-3 py-2 text-sm text-[var(--psc-muted)]">
        Council session unlocks on turns 1–5 each cycle. You&apos;re in the election phase — use <strong>End turn →</strong> after
        PAC work, or switch to Elections &amp; PAC.
      </p>
    );
  }

  if (!isStrategist) {
    return (
      <p className="text-sm text-[var(--psc-muted)]">Enroll as party strategist to run caucus rounds.</p>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-amber-300/60 bg-gradient-to-r from-amber-950/5 to-[var(--psc-panel)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Legislative round</p>
            <p className="mt-0.5 text-base font-semibold text-[var(--psc-ink)]">
              {status.roundId ? phaseLabel(status.roundPhase) : "No round started"}
            </p>
          </div>
          {status.roundId ? (
            <div className="min-w-[200px] flex-1 max-w-md">
              <PhaseStepper currentPhase={status.roundPhase} />
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid gap-4 border-t border-[var(--psc-border)]/60 pt-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-blue-700">You · {partyName(humanParty)}</span>
              <span className="font-semibold tabular-nums text-[var(--psc-ink)]">{status.myPoliticalCapital}</span>
            </div>
            <CapitalBar value={status.myPoliticalCapital} max={capMax} color="blue" />
          </div>
          <div className="hidden text-center text-xs font-semibold text-[var(--psc-muted)] sm:block">vs</div>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-red-700">Rival · {partyName(rivalParty)}</span>
              <span className="font-semibold tabular-nums text-[var(--psc-ink)]">{status.rivalPoliticalCapital}</span>
            </div>
            <CapitalBar value={status.rivalPoliticalCapital} max={capMax} color="red" />
          </div>
        </div>
      </section>

      {flash ? <FlashBanner flash={flash} /> : null}

      {!status.roundId ? (
        <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 text-center">
          <h3 className="text-lg font-semibold text-[var(--psc-ink)]">Start this turn&apos;s legislative round</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--psc-muted)]">
            {status.leadershipRequired
              ? "Council turn 1 — nominate Council Spokesperson, then file a priority ordinance."
              : "File a priority ordinance and whip your caucus. Spokesperson carries over from turn 1."}
          </p>
          <button type="button" disabled={pending} onClick={() => run(startLegislativeRound)} className={`mt-4 ${btnPrimary}`}>
            {pending ? "Starting…" : "Start legislative round"}
          </button>
        </section>
      ) : (
        <div className="space-y-4">
          {/* ── LEADERSHIP (turn 1 only) ── */}
          {status.roundPhase === "leadership" && status.leadershipRequired ? (
            <Panel
              title="Nominate Council Spokesperson"
              subtitle="Turn 1 only. All 7 members vote on party lines when you advance."
            >
              <div className="grid gap-3 sm:grid-cols-3">
                {LEADERSHIP_ROLES.map((r) => {
                  const noms = leadership.filter((l) => l.roleKey === r.key);
                  const available = roleAvailable(r.key);
                  return (
                    <div
                      key={r.key}
                      className={`rounded border p-3 ${
                        !available ? "opacity-50" : nomRole === r.key ? "border-[var(--psc-seal)] bg-[var(--psc-canvas)]/60" : "border-[var(--psc-border)] bg-[var(--psc-panel)]"
                      }`}
                    >
                      <button type="button" disabled={!available} onClick={() => setNomRole(r.key)} className="w-full text-left disabled:cursor-not-allowed">
                        <p className="text-sm font-semibold text-[var(--psc-ink)]">{r.label}</p>
                        <p className="text-[10px] text-[var(--psc-muted)]">
                          {available ? r.desc : "Unavailable — caucus is split or wrong party role"}
                        </p>
                      </button>
                      {noms.length > 0 ? (
                        <ul className="mt-2 space-y-1 border-t border-[var(--psc-border)] pt-2 text-xs">
                          {noms.map((l) => (
                            <li key={l.simPoliticianId} className="flex items-center justify-between">
                              <span className={l.party === humanParty ? "text-blue-700" : "text-red-700"}>{l.name}</span>
                              {l.won ? <span className="text-emerald-700">Won</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-[10px] italic text-[var(--psc-muted)]">No nominees yet</p>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="mt-4 text-xs text-[var(--psc-muted)]">Select a caucus member, then nominate:</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {myCouncil.map((c) => (
                  <PoliticianCard
                    key={c.simPoliticianId}
                    member={c}
                    humanParty={humanParty}
                    selected={nomSim === c.simPoliticianId}
                    selectable
                    onSelect={() => setNomSim(c.simPoliticianId)}
                  />
                ))}
              </div>

              <button
                type="button"
                disabled={nomPending || !nomSim || !roleAvailable(nomRole)}
                onClick={() => runNom(() => nominateLeadership(nomSim, nomRole))}
                className={`mt-4 ${btnSecondary}`}
              >
                {nomPending ? "Nominating…" : `Nominate for ${LEADERSHIP_ROLES.find((r) => r.key === nomRole)?.label}`}
              </button>
            </Panel>
          ) : null}

          {/* ── PROPOSALS ── */}
          {status.roundPhase === "proposals" ? (
            <>
              <Panel
                title="Select legislation"
                subtitle="Four rotating Millbrook issues this turn."
              >
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Issue</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {featuredIssues.map((t) => {
                    const selected = selectedTemplate?.issue_key === t.issue_key;
                    return (
                      <button
                        key={t.issue_key}
                        type="button"
                        disabled={status.humanProposalSubmitted}
                        onClick={() => setSelectedIssueKey(t.issue_key)}
                        className={`rounded border p-3 text-left transition-colors ${
                          selected
                            ? "border-[var(--psc-accent)] bg-blue-50/50 ring-1 ring-[var(--psc-accent)]/30"
                            : "border-[var(--psc-border)] bg-[var(--psc-panel)] hover:border-[var(--psc-accent)]/40"
                        } ${status.humanProposalSubmitted ? "opacity-60" : ""}`}
                      >
                        <p className="text-sm font-semibold text-[var(--psc-ink)]">{t.display_name}</p>
                        <p className="mt-0.5 text-[10px] text-[var(--psc-muted)]">{t.description}</p>
                      </button>
                    );
                  })}
                </div>

                {selectedTemplate ? (
                  <div className="mt-5 space-y-4 border-t border-[var(--psc-border)] pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Stance</p>
                    <StancePicker
                      template={selectedTemplate}
                      selected={selectedStance}
                      disabled={status.humanProposalSubmitted}
                      onSelect={setSelectedStance}
                    />
                  </div>
                ) : null}

                <div className="mt-5 grid gap-4 border-t border-[var(--psc-border)] pt-4 lg:grid-cols-2">
                  <label className="block text-xs text-[var(--psc-muted)]">
                    Floor sponsor
                    <select
                      value={sponsorSim}
                      onChange={(e) => setSponsorSim(e.target.value)}
                      disabled={status.humanProposalSubmitted}
                      className={`${inputClass} disabled:opacity-60`}
                    >
                      <option value="">Pick sponsor…</option>
                      {myCouncil.map((c) => (
                        <option key={c.simPoliticianId} value={c.simPoliticianId}>
                          {c.name} · cap {c.politicalCapital}
                        </option>
                      ))}
                    </select>
                  </label>

                  {composedBill ? (
                    <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Preview</p>
                      <p className="mt-1 font-semibold text-[var(--psc-ink)]">{composedBill.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--psc-muted)]">{composedBill.summary}</p>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={pending || status.humanProposalSubmitted || !sponsorSim || !composedBill}
                    onClick={() =>
                      composedBill &&
                      run(() =>
                        proposeRoundBill({
                          sponsorSimId: sponsorSim,
                          title: composedBill.title,
                          summary: composedBill.summary,
                          issueKey: composedBill.issueKey,
                          stanceKey: composedBill.stanceKey,
                          policyValue: composedBill.policyValue,
                        }),
                      )
                    }
                    className={btnPrimary}
                  >
                    {status.humanProposalSubmitted ? "Bill filed" : "File to hopper"}
                  </button>
                  <ActionChip tone="cost">−2 sponsor capital</ActionChip>
                </div>
              </Panel>

              {bills.length > 0 ? (
                <Panel title="Floor docket" subtitle="Both caucus bills will be heard in order — yours first, then the rival's.">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {bills.map((b) => (
                      <BillCard
                        key={b.id}
                        bill={b}
                        humanParty={humanParty}
                        hearingNow={status.activeBillId === b.id && (status.roundPhase === "council_vote" || status.roundPhase === "house_vote")}
                      />
                    ))}
                  </div>
                </Panel>
              ) : null}
            </>
          ) : null}

          {/* ── FLOOR VOTE ── */}
          {status.roundPhase === "council_vote" || status.roundPhase === "house_vote" ? (
            <>
              {activeBill ? (
                <section className="rounded border border-amber-300/50 bg-amber-50/30 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                    Council floor · lining up votes
                  </p>
                  <h3 className="mt-0.5 text-base font-semibold text-[var(--psc-ink)]">{activeBill.title}</h3>
                  <p className="mt-1 text-xs text-[var(--psc-muted)]">
                    Assign your caucus for free, then pay PAC to convince rivals. When ready, call the vote to see the roll call.
                  </p>
                </section>
              ) : null}

              {/* Prior chamber roll calls for this bill */}
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Your caucus" subtitle="Free — you control these votes. Default is party-line yea on your bill.">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <button type="button" disabled={pending} onClick={() => run(() => assignAllCaucus("yea"))} className={btnSecondary}>
                      Lock all YEA
                    </button>
                    <button type="button" disabled={pending} onClick={() => run(() => assignAllCaucus("nay"))} className={btnSecondary}>
                      Lock all NAY
                    </button>
                  </div>
                  <div className="mb-3 flex gap-2">
                    {(["yea", "nay"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setWhipVote(v)}
                        className={`flex-1 rounded border py-2 text-sm font-semibold uppercase ${
                          whipVote === v
                            ? v === "yea"
                              ? "border-emerald-600 bg-emerald-600 text-white"
                              : "border-red-600 bg-red-600 text-white"
                            : "border-[var(--psc-border)] bg-[var(--psc-canvas)] text-[var(--psc-muted)]"
                        }`}
                      >
                        Assign {v}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {myVoteCaucus.map((c) => {
                      const assigned = assignmentBySim.get(c.simPoliticianId);
                      return (
                        <div key={c.simPoliticianId} className="relative">
                          <PoliticianCard
                            member={c}
                            humanParty={humanParty}
                            selected={whipSim === c.simPoliticianId}
                            selectable
                            onSelect={() => setWhipSim(c.simPoliticianId)}
                          />
                          {assigned ? (
                            <span
                              className={`absolute right-2 top-2 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                assigned.vote === "yea" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
                              }`}
                            >
                              {assigned.vote}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4">
                    <button type="button" disabled={pending || !whipSim} onClick={() => run(() => whipNpc(whipSim, whipVote))} className={btnSecondary}>
                      Assign selected vote
                    </button>
                    <ActionChip tone="neutral">Free</ActionChip>
                  </div>
                </Panel>

                <Panel title="Convince rivals" subtitle="Pay from PAC treasury to flip cross-aisle votes.">
                  <p className="mb-3 text-xs text-[var(--psc-muted)]">
                    Convince limit: {status.crossAisleFlips}/{status.crossAisleFlipLimit} this round. Target lower-loyalty members.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {rivalVoteCaucus.map((c) => {
                      const assigned = assignmentBySim.get(c.simPoliticianId);
                      return (
                        <div key={c.simPoliticianId} className="relative">
                          <PoliticianCard
                            member={c}
                            humanParty={humanParty}
                            selected={bribeSim === c.simPoliticianId}
                            selectable
                            showLoyalty
                            onSelect={() => setBribeSim(c.simPoliticianId)}
                          />
                          {assigned ? (
                            <span
                              className={`absolute right-2 top-2 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                assigned.vote === "yea" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
                              }`}
                            >
                              {assigned.vote}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex flex-wrap items-end gap-2">
                    <label className="text-xs text-[var(--psc-muted)]">
                      PAC payment
                      <input
                        type="number"
                        step={250000}
                        value={bribeAmount}
                        onChange={(e) => setBribeAmount(e.target.value)}
                        className={`${inputClass} w-36`}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={pending || !bribeSim || Number(bribeAmount) < 500000}
                      onClick={() => run(() => bribeNpc(bribeSim, "yea", Number(bribeAmount)))}
                      className={btnSecondary}
                    >
                      Pay for YEA · {formatMoney(Number(bribeAmount))}
                    </button>
                  </div>
                </Panel>
              </div>
            </>
          ) : null}

          {/* Roll calls for prior bills on docket */}
          {bills
            .filter((b) => b.id !== activeBill?.id && rollCallFor(b.id).length > 0)
            .map((b) => (
              <RollCallPanel
                key={b.id}
                title={`Council roll call · ${b.title}`}
                rows={rollCallFor(b.id)}
                humanParty={humanParty}
                passed={b.housePassed}
              />
            ))}

          {status.roundPhase === "mayoral" || status.roundPhase === "presidential" ? (
            <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-[var(--psc-ink)]">Mayor&apos;s Office</h3>
                  <p className="mt-1 text-sm text-[var(--psc-muted)]">
                    {(status.mayorName ?? status.presidentName) ? (
                      <>
                        <span className="font-medium text-[var(--psc-ink)]">{status.mayorName ?? status.presidentName}</span>
                        {" · "}
                        {partyName(status.mayorParty ?? status.presidentParty ?? "")} · cap{" "}
                        {status.mayorCapital ?? status.presidentCapital}
                      </>
                    ) : (
                      "Mayor NPC"
                    )}
                  </p>
                  <p className="mt-2 text-xs text-[var(--psc-muted)]">
                    Win the mayor&apos;s race in election turns to control sign/veto. If the mayor is from the rival party,
                    spend political capital to lobby before advancing.
                  </p>
                </div>
                {activeBill &&
                (status.mayorParty ?? status.presidentParty) !== humanParty &&
                activeBill.party === humanParty ? (
                  <button type="button" disabled={pending} onClick={() => run(() => lobbyMayor(8))} className={btnSecondary}>
                    Lobby mayor (−8 cap)
                  </button>
                ) : null}
              </div>
              {activeBill && rollCallFor(activeBill.id).length > 0 ? (
                <RollCallPanel
                  title={`Council roll call · ${activeBill.title}`}
                  rows={rollCallFor(activeBill.id)}
                  humanParty={humanParty}
                  passed={activeBill.housePassed}
                />
              ) : null}
              {activeBill ? (
                <p className="mt-4 text-sm font-medium text-[var(--psc-ink)]">Awaiting action: {activeBill.title}</p>
              ) : null}
            </section>
          ) : null}

          {status.roundPhase === "completed" && bills.length > 0 ? (
            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Round results</h3>
              <p className="text-xs text-[var(--psc-muted)]">Round complete — staff advances the sim week when ready.</p>
              {bills.map((b) => (
                <div key={b.id} className="space-y-3">
                  <BillCard bill={b} humanParty={humanParty} />
                  {rollCallFor(b.id).length > 0 ? (
                    <RollCallPanel
                      title={`Council roll call · ${b.title}`}
                      rows={rollCallFor(b.id)}
                      humanParty={humanParty}
                      passed={b.housePassed}
                    />
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}

          {status.roundPhase === "completed" && bills.length === 0 && activeBill ? (
            <section
              className={`rounded border p-6 text-center ${
                activeBill.signed
                  ? "border-emerald-300 bg-emerald-50/50"
                  : activeBill.vetoed
                    ? "border-red-300 bg-red-50/50"
                    : "border-[var(--psc-border)] bg-[var(--psc-panel)]"
              }`}
            >
              <h3 className="text-base font-semibold text-[var(--psc-ink)]">
                {activeBill.signed ? "Law enacted" : activeBill.vetoed ? "Vetoed" : "Bill failed"}
              </h3>
              <p className="mt-1 text-sm text-[var(--psc-muted)]">{activeBill.title}</p>
              <div className="mx-auto mt-4 flex max-w-xs justify-center gap-6 text-sm tabular-nums">
                <div>
                  <p className="text-[10px] uppercase text-[var(--psc-muted)]">Council</p>
                  <p className="font-semibold text-[var(--psc-ink)]">
                    {activeBill.houseYeas}-{activeBill.houseNays}
                  </p>
                </div>
              </div>
              {activeBill.signed ? (
                <div className="mt-3">
                  <ActionChip tone="reward">+10 political capital</ActionChip>
                </div>
              ) : null}
            </section>
          ) : null}

          {status.roundPhase && status.roundPhase !== "completed" ? (
            <button type="button" disabled={pending} onClick={() => run(advanceLegislativeRound)} className={`w-full ${btnPrimary} py-2.5`}>
              {advanceLabel()}
            </button>
          ) : null}
        </div>
      )}

      {status.roundId ? (
        <Panel title="Caucus roster" subtitle="Seven Millbrook council members in tonight's war caucus.">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-700">
                Your caucus · {partyName(humanParty)}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {myCouncil.map((c) => (
                  <PoliticianCard key={c.simPoliticianId} member={c} humanParty={humanParty} />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700">
                Rival caucus · {partyName(rivalParty)}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {rivalCouncil.map((c) => (
                  <PoliticianCard key={c.simPoliticianId} member={c} humanParty={humanParty} showLoyalty />
                ))}
              </div>
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
