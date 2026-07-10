"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  councilOrdinanceVote,
  proposeCouncilOrdinance,
  type CouncilLegislationResult,
} from "@/app/actions/council-legislation";
import {
  ORDINANCE_CATEGORIES,
  issueUsesStanceParams,
  ordinanceStanceLabel,
  type OrdinanceCategory,
  type OrdinanceStanceKey,
} from "@/lib/city-ordinance-templates";
import {
  clampStanceParamsForIssue,
  defaultStanceParamsForIssue,
  isMarijuanaStanceParams,
  isRegistryStanceParams,
  issueUsesParametricScoring,
  scoreOrdinanceByIssue,
  type OrdinanceStanceParams,
} from "@/lib/city-ordinance-param-score";
import { isRegistryParametricIssue } from "@/lib/city-ordinance-param-registry";
import { isMarijuanaIssue } from "@/lib/marijuana-ordinance-scoring";
import { MarijuanaOrdinanceParamsForm } from "@/components/marijuana-ordinance-params";
import { ParametricOrdinanceParamsForm } from "@/components/parametric-ordinance-params-form";
import type { OrdinanceProposalRow } from "@/lib/city-office-data";
import {
  OrdinanceRollCallTable,
  ordinanceStatusLabel,
} from "@/components/ordinance-roll-call-table";
import { OrdinanceEffectPreview } from "@/components/ordinance-effect-preview";
import { OrdinanceVotePreviewPanel } from "@/components/ordinance-vote-preview";

function formatVoteDeadline(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function PendingOrdinanceVoteCard({
  proposal,
  canVote,
  pending,
  onVote,
}: {
  proposal: OrdinanceProposalRow;
  canVote: boolean;
  pending: boolean;
  onVote: (proposalId: string, vote: "yea" | "nay") => void;
}) {
  return (
    <section className="space-y-3 rounded border border-amber-400/60 bg-amber-50/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-[var(--psc-ink)]">Pending council vote</h3>
        <span className="rounded border border-amber-600 bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-900">
          {ordinanceStatusLabel(proposal.status)}
        </span>
      </div>
      <p className="text-sm font-medium text-[var(--psc-ink)]">{proposal.title}</p>
      <p className="text-xs text-[var(--psc-muted)]">{proposal.summary}</p>
      {formatVoteDeadline(proposal.councilVoteClosesAt) ? (
        <p className="text-xs font-medium text-amber-900">
          Council vote closes ~{formatVoteDeadline(proposal.councilVoteClosesAt)} (or when all
          player-held seats vote).
        </p>
      ) : null}
      <p className="text-xs text-[var(--psc-muted)]">
        Sponsor: {proposal.sponsorName ?? "Unknown"} ·{" "}
        {issueUsesParametricScoring(proposal.issueKey) && proposal.stanceParams
          ? ordinanceStanceLabel(
              proposal.category,
              proposal.issueKey,
              null,
              proposal.stanceParams,
            )
          : (
            <>
              Stance: <span className="font-semibold capitalize">{proposal.stanceKey}</span>
            </>
          )}
        {proposal.councilYeas + proposal.councilNays > 0
          ? ` · ${proposal.councilYeas}–${proposal.councilNays}`
          : ""}
      </p>
      <OrdinanceEffectPreview
        category={proposal.category}
        issueKey={proposal.issueKey}
        stanceKey={proposal.stanceKey}
        stanceParams={proposal.stanceParams}
      />
      <OrdinanceRollCallTable rows={proposal.rollCall} />
      {canVote ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            className="rounded border border-green-700 px-3 py-1.5 text-sm font-semibold text-green-800 disabled:opacity-50"
            onClick={() => onVote(proposal.id, "yea")}
          >
            Vote Yea
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded border border-red-800 px-3 py-1.5 text-sm font-semibold text-red-800 disabled:opacity-50"
            onClick={() => onVote(proposal.id, "nay")}
          >
            Vote Nay
          </button>
        </div>
      ) : (
        <p className="text-xs text-[var(--psc-muted)]">
          Awaiting council roll call — only council members may vote.
        </p>
      )}
    </section>
  );
}

type Props = {
  canPropose: boolean;
  proposeSubmitEnabled?: boolean;
  canVote: boolean;
  legislationBlockedReason?: string | null;
  awaitingMayorOrdinances?: OrdinanceProposalRow[];
  pendingProposals: OrdinanceProposalRow[];
  recentProposals: OrdinanceProposalRow[];
};

export function CouncilLegislationPanel({
  canPropose,
  proposeSubmitEnabled = true,
  canVote,
  legislationBlockedReason = null,
  awaitingMayorOrdinances = [],
  pendingProposals,
  recentProposals,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<CouncilLegislationResult | null>(null);
  const [category, setCategory] = useState<OrdinanceCategory>("crime");
  const [issueKey, setIssueKey] = useState<string>(
    ORDINANCE_CATEGORIES[0]?.issues[0]?.issueKey ?? "",
  );
  const [stanceKey, setStanceKey] = useState<OrdinanceStanceKey | "">("");
  const [stanceParams, setStanceParams] = useState<OrdinanceStanceParams | null>(
    defaultStanceParamsForIssue(ORDINANCE_CATEGORIES[0]?.issues[0]?.issueKey ?? ""),
  );

  const activeCategory = useMemo(
    () => ORDINANCE_CATEGORIES.find((c) => c.key === category),
    [category],
  );

  const activeIssue = useMemo(() => {
    const issues = activeCategory?.issues ?? [];
    return issues.find((i) => i.issueKey === issueKey) ?? issues[0];
  }, [activeCategory, issueKey]);

  const usesParams = activeIssue ? issueUsesStanceParams(activeIssue) : false;
  const paramScores = useMemo(
    () =>
      usesParams && activeIssue && stanceParams
        ? scoreOrdinanceByIssue(activeIssue.issueKey, stanceParams)
        : null,
    [usesParams, activeIssue, stanceParams],
  );
  const formReady = usesParams ? Boolean(stanceParams) : Boolean(stanceKey);

  function run(fn: () => Promise<CouncilLegislationResult>) {
    start(async () => {
      const result = await fn();
      setFlash(result);
      if (result.ok) router.refresh();
    });
  }

  function selectIssue(nextIssueKey: string) {
    setIssueKey(nextIssueKey);
    setStanceKey("");
    setStanceParams(defaultStanceParamsForIssue(nextIssueKey));
  }

  if (!canPropose && !canVote) {
    if (legislationBlockedReason) {
      return (
        <section className="rounded border border-amber-400/50 bg-amber-50/90 p-6 text-sm text-amber-950">
          {legislationBlockedReason}
        </section>
      );
    }
    return (
      <section className="rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 text-sm text-[var(--psc-muted)]">
        You need the <strong className="text-[var(--psc-ink)]">mayor</strong> or{" "}
        <strong className="text-[var(--psc-ink)]">council member</strong> role to draft and propose city
        ordinances.
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {flash ? (
        <p
          className={`rounded border px-3 py-2 text-sm ${
            flash.ok
              ? "border-green-800/40 bg-green-950/30 text-green-200"
              : "border-red-800/40 bg-red-950/30 text-red-200"
          }`}
        >
          {flash.message}
        </p>
      ) : null}

      {legislationBlockedReason ? (
        <p className="rounded border border-amber-400/50 bg-amber-50/90 px-3 py-2 text-sm text-amber-950">
          {legislationBlockedReason}
        </p>
      ) : null}

      {pendingProposals.map((proposal) => (
        <PendingOrdinanceVoteCard
          key={proposal.id}
          proposal={proposal}
          canVote={canVote}
          pending={pending}
          onVote={(proposalId, vote) => run(() => councilOrdinanceVote(proposalId, vote))}
        />
      ))}

      {awaitingMayorOrdinances.length > 0 ? (
        <p className="rounded border border-violet-400/50 bg-violet-50/80 px-3 py-2 text-xs text-violet-950">
          {awaitingMayorOrdinances.length} ordinance
          {awaitingMayorOrdinances.length === 1 ? "" : "s"} passed council and{" "}
          {awaitingMayorOrdinances.length === 1 ? "is" : "are"} awaiting mayor signature — you can
          still file more bills.
        </p>
      ) : null}

      {canPropose ? (
      <section className="overflow-hidden rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]">
        <div className="border-b border-[var(--psc-border)] px-4 py-3">
          <h2 className="font-semibold text-[var(--psc-ink)]">Create legislation</h2>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Pick a policy category, choose an ordinance type, then set parameters or stance. Filed
            ordinances go to the council for a roll-call vote.
          </p>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-[var(--psc-border)] bg-[var(--psc-canvas)] px-2 py-2">
          {ORDINANCE_CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                setCategory(c.key);
                const firstIssue = c.issues[0]?.issueKey ?? "";
                setIssueKey(firstIssue);
                setStanceKey("");
                setStanceParams(defaultStanceParamsForIssue(firstIssue));
              }}
              className={
                category === c.key
                  ? "rounded bg-[var(--psc-ink)] px-3 py-1.5 text-xs font-semibold text-white"
                  : "rounded border border-[var(--psc-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--psc-ink)] hover:border-[var(--psc-accent)]"
              }
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>

        <div className="grid gap-0 md:grid-cols-[minmax(180px,220px)_1fr]">
          <aside className="border-b border-[var(--psc-border)] md:border-b-0 md:border-r">
            <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
              Bill types
            </p>
            <ul className="divide-y divide-[var(--psc-border)]">
              {(activeCategory?.issues ?? []).map((issue) => (
                <li key={issue.issueKey}>
                  <button
                    type="button"
                    onClick={() => selectIssue(issue.issueKey)}
                    className={`w-full px-3 py-2.5 text-left text-sm transition hover:bg-white ${
                      activeIssue?.issueKey === issue.issueKey
                        ? "bg-white font-semibold text-[var(--psc-accent)]"
                        : "text-[var(--psc-ink)]"
                    }`}
                  >
                    {issue.title}
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="space-y-4 p-4">
            {activeIssue ? (
              <>
                <div>
                  <h3 className="text-lg font-semibold text-[var(--psc-ink)]">{activeIssue.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--psc-muted)]">{activeIssue.summary}</p>
                </div>

                {usesParams && stanceParams && isMarijuanaIssue(activeIssue.issueKey) && isMarijuanaStanceParams(stanceParams) ? (
                  <>
                    <MarijuanaOrdinanceParamsForm
                      params={stanceParams}
                      onChange={(next) => {
                        const clamped = clampStanceParamsForIssue(activeIssue.issueKey, next);
                        if (clamped) setStanceParams(clamped);
                      }}
                    />
                    <OrdinanceEffectPreview
                      category={category}
                      issueKey={activeIssue.issueKey}
                      stanceParams={stanceParams}
                    />
                    <OrdinanceVotePreviewPanel
                      category={category}
                      issueKey={activeIssue.issueKey}
                      stanceParams={stanceParams}
                      issueEconomicScore={paramScores?.issue_economic_score}
                      issueSocialScore={paramScores?.issue_social_score}
                    />
                  </>
                ) : usesParams &&
                  stanceParams &&
                  isRegistryParametricIssue(activeIssue.issueKey) &&
                  isRegistryStanceParams(activeIssue.issueKey, stanceParams) ? (
                  <>
                    <ParametricOrdinanceParamsForm
                      issueKey={activeIssue.issueKey}
                      params={stanceParams}
                      onChange={(next) => {
                        const clamped = clampStanceParamsForIssue(activeIssue.issueKey, next);
                        if (clamped) setStanceParams(clamped);
                      }}
                    />
                    <OrdinanceEffectPreview
                      category={category}
                      issueKey={activeIssue.issueKey}
                      stanceParams={stanceParams}
                    />
                    <OrdinanceVotePreviewPanel
                      category={category}
                      issueKey={activeIssue.issueKey}
                      stanceParams={stanceParams}
                      issueEconomicScore={paramScores?.issue_economic_score}
                      issueSocialScore={paramScores?.issue_social_score}
                    />
                  </>
                ) : usesParams ? (
                  <p className="text-sm text-[var(--psc-muted)]">Parameter form not available for this bill.</p>
                ) : (
                  <>
                    <fieldset className="space-y-2">
                      <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                        Stance spectrum
                      </legend>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {"stances" in activeIssue &&
                          activeIssue.stances.map((stance) => (
                            <label
                              key={stance.key}
                              className={`cursor-pointer rounded border p-3 text-sm transition ${
                                stanceKey === stance.key
                                  ? "border-[var(--psc-accent)] bg-white ring-2 ring-[var(--psc-accent)]/30"
                                  : "border-[var(--psc-border)] bg-[var(--psc-canvas)] hover:border-[var(--psc-accent)]"
                              }`}
                            >
                              <input
                                type="radio"
                                name="ordinance-stance"
                                value={stance.key}
                                checked={stanceKey === stance.key}
                                onChange={() => setStanceKey(stance.key)}
                                className="sr-only"
                              />
                              <span className="block font-semibold capitalize text-[var(--psc-ink)]">
                                {stance.label}
                              </span>
                              <span className="mt-1 block text-xs leading-relaxed text-[var(--psc-muted)]">
                                {stance.description}
                              </span>
                            </label>
                          ))}
                      </div>
                    </fieldset>

                    {stanceKey ? (
                      <>
                        <OrdinanceEffectPreview
                          category={category}
                          issueKey={activeIssue.issueKey}
                          stanceKey={stanceKey}
                        />
                        <OrdinanceVotePreviewPanel
                          category={category}
                          issueKey={activeIssue.issueKey}
                          stanceKey={stanceKey}
                        />
                      </>
                    ) : null}
                  </>
                )}

                <button
                  type="button"
                  disabled={pending || !formReady || !proposeSubmitEnabled}
                  className="rounded bg-[var(--psc-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={() => {
                    if (!activeIssue || !formReady) return;
                    if (usesParams && stanceParams) {
                      const clamped = clampStanceParamsForIssue(activeIssue.issueKey, stanceParams);
                      if (!clamped) return;
                      run(() =>
                        proposeCouncilOrdinance({
                          category,
                          issueKey: activeIssue.issueKey,
                          stanceParams: clamped,
                        }),
                      );
                      return;
                    }
                    if (!stanceKey) return;
                    run(() =>
                      proposeCouncilOrdinance({
                        category,
                        issueKey: activeIssue.issueKey,
                        stanceKey,
                      }),
                    );
                  }}
                >
                  Propose ordinance
                </button>
                {!proposeSubmitEnabled && legislationBlockedReason ? (
                  <p className="text-xs text-amber-900">{legislationBlockedReason}</p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </section>
      ) : null}

      {recentProposals.length > 0 ? (
        <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
          <h3 className="font-semibold text-[var(--psc-ink)]">Recent filings</h3>
          <ul className="mt-2 divide-y divide-[var(--psc-border)] text-sm">
            {recentProposals.slice(0, 5).map((p) => (
              <li key={p.id} className="py-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium text-[var(--psc-ink)]">{p.title}</span>
                  <span className="rounded border border-[var(--psc-border)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--psc-muted)]">
                    {ordinanceStatusLabel(p.status)}
                  </span>
                  {(p.status === "enacted" ||
                    p.status === "rejected" ||
                    p.status === "awaiting_mayor" ||
                    p.status === "vetoed") &&
                  p.councilYeas + p.councilNays > 0
                    ? (
                      <span className="text-xs text-[var(--psc-muted)]">
                        {p.councilYeas}–{p.councilNays}
                      </span>
                    )
                    : null}
                </div>
                {p.rollCall.length > 0 &&
                (p.status === "awaiting_mayor" ||
                  p.status === "enacted" ||
                  p.status === "rejected" ||
                  p.status === "vetoed") ? (
                  <OrdinanceRollCallTable rows={p.rollCall} />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
