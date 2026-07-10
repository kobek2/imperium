"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { agSubmitArgument } from "@/app/actions/attorney-general";
import { ProfileImageWithFallback } from "@/components/profile-image-with-fallback";
import type { CourtAgenda } from "@/lib/court-case-agenda";

type Phase =
  | { kind: "frame" }
  | { kind: "rebuttal"; frameIdx: number }
  | { kind: "justice"; frameIdx: number; rebuttalIdx: number; questionIdx: 0 | 1 | 2; prior: number[] }
  | { kind: "submitting" };

function ChamberCard({
  variant,
  portraitUrl,
  name,
  subtitle,
  body,
}: {
  variant: "court" | "us";
  portraitUrl: string | null;
  name: string;
  subtitle: string;
  body: string;
}) {
  const frame =
    variant === "court"
      ? "rounded-xl border-[3px] border-amber-400 bg-[var(--psc-panel)] ring-1 ring-inset ring-amber-200"
      : "rounded-xl border-[3px] border-[var(--psc-accent)] bg-[var(--psc-panel)] ring-1 ring-inset ring-[var(--psc-border)]";
  return (
    <article className={`p-4 shadow-sm ${frame}`}>
      <div className="flex flex-wrap items-start gap-4">
        <div
          className={`h-20 w-20 shrink-0 overflow-hidden rounded border ${
            variant === "court" ? "border-amber-500 bg-white" : "border-[var(--psc-border)] bg-white"
          }`}
        >
          <ProfileImageWithFallback
            src={portraitUrl}
            name={name}
            variant="portrait"
            initialClassName="flex h-full w-full items-center justify-center text-xl font-semibold text-[var(--psc-muted)]"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={`text-[10px] font-bold uppercase tracking-[0.18em] ${
              variant === "court" ? "text-amber-800" : "text-[var(--psc-muted)]"
            }`}
          >
            {subtitle}
          </p>
          <h3 className="truncate text-lg font-semibold text-[var(--psc-ink)]">{name}</h3>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--psc-ink)]">{body}</p>
        </div>
      </div>
    </article>
  );
}

function ChoiceList({
  prompt,
  options,
  onPick,
  disabled,
}: {
  prompt: string;
  options: ReadonlyArray<{ id: string; line: string }>;
  onPick: (idx: number) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">{prompt}</p>
      <div className="grid gap-2">
        {options.map((opt, idx) => (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(idx)}
            className="rounded-lg border border-[var(--psc-border)] bg-white px-4 py-3 text-left text-sm leading-snug text-[var(--psc-ink)] shadow-sm transition hover:bg-[var(--psc-canvas)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {opt.line}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AttorneyGeneralArgumentMode({
  caseId,
  side,
  agenda,
  agName,
  agPortraitUrl,
}: {
  caseId: string;
  side: "defend" | "challenge";
  agenda: CourtAgenda;
  agName: string;
  agPortraitUrl: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "frame" });
  const [usLine, setUsLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const position = side === "defend" ? agenda.defendPosition : agenda.challengePosition;
  const opposingArgument =
    side === "defend" ? agenda.defendOpposingArgument : agenda.challengeOpposingArgument;

  const submit = (choices: number[]) => {
    setPhase({ kind: "submitting" });
    setError(null);
    start(async () => {
      try {
        await agSubmitArgument({ caseId, side, choices });
        router.push("/cabinet/justice");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not record argument.");
        setPhase({ kind: "justice", frameIdx: choices[0]!, rebuttalIdx: choices[1]!, questionIdx: 2, prior: choices.slice(0, 4) });
      }
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--psc-muted)]">
          Oral argument · {agenda.caseLabel}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">
          Position: <span className="font-bold">{side === "defend" ? "Defend" : "Challenge"}</span> · {position}
        </h1>
        <p className="text-sm text-[var(--psc-muted)]">
          Question presented: {agenda.questionPresented}
        </p>
        {agenda.tiltParty ? (
          <p className="text-xs text-[var(--psc-muted)]">
            Court composition this term skews <span className="font-semibold">{agenda.tiltParty === "D" ? "left" : "right"}</span>.
          </p>
        ) : null}
      </header>

      {error ? (
        <div className="rounded border border-red-600 bg-red-50 p-3 text-sm text-red-950">{error}</div>
      ) : null}

      {phase.kind === "frame" ? (
        <div className="space-y-4">
          <ChamberCard
            variant="court"
            portraitUrl={null}
            name="Counsel for the opposing parties"
            subtitle="Brief on file"
            body={opposingArgument}
          />
          <ChoiceList
            prompt="Choose your opening frame"
            options={agenda.frames.map((f, ix) => ({ id: `frame-${ix}`, line: `${f.label}: ${f.lead}` }))}
            disabled={pending}
            onPick={(idx) => {
              setUsLine(`Opening frame: ${agenda.frames[idx]!.label}.`);
              setPhase({ kind: "rebuttal", frameIdx: idx });
            }}
          />
        </div>
      ) : null}

      {phase.kind === "rebuttal" ? (
        <div className="space-y-4">
          {usLine ? (
            <ChamberCard
              variant="us"
              portraitUrl={agPortraitUrl}
              name={agName}
              subtitle="United States — Department of Justice"
              body={`${usLine}\n${agenda.frames[phase.frameIdx]!.lead}`}
            />
          ) : null}
          <ChamberCard
            variant="court"
            portraitUrl={null}
            name="Counsel for the opposing parties"
            subtitle="Rebuts your opening"
            body={opposingArgument}
          />
          <ChoiceList
            prompt="Choose your rebuttal"
            options={agenda.rebuttals[phase.frameIdx as 0 | 1 | 2]!.map((r) => ({ id: r.id, line: r.line }))}
            disabled={pending}
            onPick={(idx) => {
              const reb = agenda.rebuttals[phase.frameIdx as 0 | 1 | 2]![idx as 0 | 1 | 2]!;
              setUsLine(reb.line);
              setPhase({
                kind: "justice",
                frameIdx: phase.frameIdx,
                rebuttalIdx: idx,
                questionIdx: 0,
                prior: [phase.frameIdx, idx],
              });
            }}
          />
        </div>
      ) : null}

      {phase.kind === "justice" ? (
        (() => {
          const justice = agenda.justices[phase.questionIdx]!;
          const alignmentLabel =
            justice.alignment === "friendly"
              ? "Friendly questioning"
              : justice.alignment === "swing"
                ? "Swing-vote questioning"
                : "Hostile questioning";
          return (
            <div className="space-y-4">
              {usLine ? (
                <ChamberCard
                  variant="us"
                  portraitUrl={agPortraitUrl}
                  name={agName}
                  subtitle="United States — Department of Justice"
                  body={usLine}
                />
              ) : null}
              <ChamberCard
                variant="court"
                portraitUrl={null}
                name={justice.justiceName}
                subtitle={`Associate Justice · ${alignmentLabel}`}
                body={justice.question}
              />
              <ChoiceList
                prompt={`Question ${phase.questionIdx + 1} of 3 — choose your response`}
                options={justice.responses.map((r) => ({ id: r.id, line: r.line }))}
                disabled={pending}
                onPick={(idx) => {
                  const resp = justice.responses[idx as 0 | 1 | 2]!;
                  setUsLine(resp.line);
                  if (phase.questionIdx < 2) {
                    setPhase({
                      kind: "justice",
                      frameIdx: phase.frameIdx,
                      rebuttalIdx: phase.rebuttalIdx,
                      questionIdx: (phase.questionIdx + 1) as 0 | 1 | 2,
                      prior: [...phase.prior, idx],
                    });
                  } else {
                    submit([...phase.prior, idx]);
                  }
                }}
              />
              {phase.questionIdx === 2 ? (
                <p className="text-xs text-[var(--psc-muted)]">
                  Your final response closes the argument and the Court will rule. The ruling consumes 8 hours from
                  today&apos;s engagement budget.
                </p>
              ) : null}
            </div>
          );
        })()
      ) : null}

      {phase.kind === "submitting" ? (
        <p className="text-center text-sm text-[var(--psc-muted)]">Recording the Court&apos;s ruling…</p>
      ) : null}
    </div>
  );
}
