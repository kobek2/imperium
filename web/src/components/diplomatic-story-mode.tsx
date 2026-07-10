"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { stateCompleteIntensiveDiplomacy } from "@/app/actions/diplomacy";
import { ProfileImageWithFallback } from "@/components/profile-image-with-fallback";
import type { DiplomaticStoryBeat, DiplomaticStoryScript } from "@/lib/diplomatic-story";

type Phase = { kind: "opening" } | { kind: "beat"; index: number } | { kind: "submitting" };

function DialogueCard({
  variant,
  portraitUrl,
  name,
  title,
  body,
}: {
  variant: "host" | "us";
  portraitUrl: string | null;
  name: string;
  title: string;
  body: string;
}) {
  const frame =
    variant === "host"
      ? "rounded-xl border-[3px] border-amber-400 bg-[var(--psc-panel)] ring-1 ring-inset ring-amber-200"
      : "rounded-xl border-[3px] border-[var(--psc-accent)] bg-[var(--psc-panel)] ring-1 ring-inset ring-[var(--psc-border)]";
  return (
    <article className={`p-4 shadow-sm ${frame}`}>
      <div className="flex flex-wrap items-start gap-4">
        <div
          className={`h-20 w-20 shrink-0 overflow-hidden rounded border ${
            variant === "host" ? "border-amber-500 bg-white" : "border-[var(--psc-border)] bg-white"
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
              variant === "host" ? "text-amber-800" : "text-[var(--psc-muted)]"
            }`}
          >
            {title}
          </p>
          <h3 className="truncate text-lg font-semibold text-[var(--psc-ink)]">{name}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--psc-ink)]">{body}</p>
        </div>
      </div>
    </article>
  );
}

export function DiplomaticStoryMode({
  script,
  sessionId,
  secretaryName,
  secretaryPortraitUrl,
}: {
  script: DiplomaticStoryScript;
  sessionId: string;
  secretaryName: string;
  secretaryPortraitUrl: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "opening" });
  const [choices, setChoices] = useState<number[]>([]);
  const [lastUsLine, setLastUsLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const beat: DiplomaticStoryBeat | null =
    phase.kind === "beat" ? script.beats[phase.index]! : null;

  function completeSession(choicePath: number[]) {
    setPhase({ kind: "submitting" });
    setError(null);
    start(async () => {
      try {
        await stateCompleteIntensiveDiplomacy({
          sessionId,
          choice0: choicePath[0]!,
          choice1: choicePath[1]!,
          choice2: choicePath[2]!,
        });
        router.push("/cabinet/state");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save session.");
        setPhase({ kind: "beat", index: 2 });
      }
    });
  }

  function chooseOption(beatIndex: number, optionIndex: number) {
    const b = script.beats[beatIndex]!;
    const opt = b.responses[optionIndex]!;
    setLastUsLine(opt.line);
    const next = [...choices, optionIndex];
    setChoices(next);
    if (beatIndex < 2) {
      setPhase({ kind: "beat", index: beatIndex + 1 });
      return;
    }
    completeSession(next);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--psc-muted)]">
          Bilateral dialogue · {script.nationDisplayName}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Private meeting</h1>
        <p className="text-sm text-[var(--psc-muted)]">{script.hostPrioritiesBlurb}</p>
      </header>

      {error ? (
        <div className="rounded border border-red-600 bg-red-50 p-3 text-sm text-red-950">{error}</div>
      ) : null}

      {phase.kind === "opening" ? (
        <div className="space-y-4">
          <DialogueCard
            variant="host"
            portraitUrl={script.portraitUrl}
            name={script.leaderName}
            title={script.leaderTitle}
            body={script.openingNpcMessage}
          />
          <button
            type="button"
            className="w-full rounded-md border-2 border-[var(--psc-accent)] bg-[color-mix(in_srgb,var(--psc-accent)_12%,white)] px-4 py-3 text-sm font-bold text-[var(--psc-ink)]"
            onClick={() => {
              setLastUsLine(null);
              setChoices([]);
              setPhase({ kind: "beat", index: 0 });
            }}
          >
            Take your seat — begin exchange
          </button>
        </div>
      ) : null}

      {phase.kind === "beat" && beat ? (
        <div className="space-y-4">
          {lastUsLine ? (
            <DialogueCard
              variant="us"
              portraitUrl={secretaryPortraitUrl}
              name={secretaryName}
              title="United States — Secretary of State"
              body={lastUsLine}
            />
          ) : null}
          <DialogueCard
            variant="host"
            portraitUrl={script.portraitUrl}
            name={script.leaderName}
            title={script.leaderTitle}
            body={beat.npcMessage}
          />
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
              Your response
            </p>
            <div className="grid gap-2">
              {beat.responses.map((opt, idx) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={pending}
                  className="rounded-lg border border-[var(--psc-border)] bg-white px-4 py-3 text-left text-sm leading-snug text-[var(--psc-ink)] shadow-sm transition hover:bg-[var(--psc-canvas)]"
                  onClick={() => chooseOption(phase.index, idx)}
                >
                  {opt.line}
                </button>
              ))}
            </div>
            {phase.index === 2 ? (
              <p className="mt-2 text-xs text-[var(--psc-muted)]">
                Your final choice closes the meeting and records outcomes (8h, relationship from alignment vs their
                stated priorities).
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {phase.kind === "submitting" ? (
        <p className="text-center text-sm text-[var(--psc-muted)]">Recording outcomes…</p>
      ) : null}
    </div>
  );
}
