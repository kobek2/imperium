"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  agDeclineToDefend,
  agFileAmicus,
  presidentSetCourtDirective,
  startCourtArgument,
} from "@/app/actions/attorney-general";
import { SubmitButton } from "@/components/submit-button";
import type { CourtAgenda, CourtAmicusOption } from "@/lib/court-case-agenda";

export type CourtCaseRow = {
  id: string;
  caseLabel: string;
  topic: string;
  factPattern: string;
  questionPresented: string;
  status: string;
  sideTaken: string | null;
  outcomeTier: string | null;
  outcomeSummary: string | null;
  presidentialDirective: "defend" | "challenge" | null;
  targetBillId: string | null;
  agenda: CourtAgenda | null;
  closesAt: string;
  openedAt: string;
};

function CountdownBadge({ closesAt }: { closesAt: string }) {
  const ms = new Date(closesAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) {
    return (
      <span className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
        Past deadline
      </span>
    );
  }
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  const label = days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;
  const tone =
    hours < 12
      ? "bg-red-700 text-white"
      : hours < 36
        ? "bg-amber-600 text-white"
        : "bg-[var(--psc-ink)] text-white";
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}>
      Closes in {label}
    </span>
  );
}

function DirectiveBanner({ directive }: { directive: "defend" | "challenge" | null }) {
  if (!directive) return null;
  return (
    <div className="rounded border-2 border-amber-500 bg-amber-50/80 px-3 py-2 text-xs text-amber-950">
      <p className="font-bold uppercase tracking-wider">Presidential directive</p>
      <p className="mt-1">
        The President has advised the Department of Justice to{" "}
        <span className="font-bold">{directive.toUpperCase()}</span> on this case. The Attorney General retains
        discretion; defying the directive carries a public-confidence cost when the ruling lands.
      </p>
    </div>
  );
}

function PresidentDirectiveControls({ caseId, current }: { caseId: string; current: "defend" | "challenge" | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (directive: "defend" | "challenge" | "") => {
    setError(null);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("case_id", caseId);
        fd.set("directive", directive);
        await presidentSetCourtDirective(fd);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save directive.");
      }
    });
  };

  return (
    <div className="rounded border border-[var(--psc-border)] bg-white/70 p-3 text-xs">
      <p className="font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Presidential directive (advisory)</p>
      <p className="mt-1 text-[var(--psc-muted)]">
        Issue or revise an advisory direction to the AG. The AG can override any directive but takes a confidence cost
        if they do.
      </p>
      {error ? <p className="mt-2 rounded border border-red-600 bg-red-50 p-2 text-red-950">{error}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => submit("defend")}
          className={`rounded border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${
            current === "defend"
              ? "border-[var(--psc-accent)] bg-[var(--psc-accent)] text-white"
              : "border-[var(--psc-border)] bg-white text-[var(--psc-ink)]"
          } ${pending ? "cursor-not-allowed opacity-50" : ""}`}
        >
          Direct: Defend
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => submit("challenge")}
          className={`rounded border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${
            current === "challenge"
              ? "border-[var(--psc-accent)] bg-[var(--psc-accent)] text-white"
              : "border-[var(--psc-border)] bg-white text-[var(--psc-ink)]"
          } ${pending ? "cursor-not-allowed opacity-50" : ""}`}
        >
          Direct: Challenge
        </button>
        <button
          type="button"
          disabled={pending || current === null}
          onClick={() => submit("")}
          className="rounded border border-[var(--psc-border)] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)] disabled:opacity-50"
        >
          Clear directive
        </button>
      </div>
    </div>
  );
}

function AmicusForm({
  caseId,
  options,
  hoursLeft,
}: {
  caseId: string;
  options: readonly CourtAmicusOption[];
  hoursLeft: number;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);

  const submit = () => {
    if (chosen == null) return;
    setError(null);
    start(async () => {
      try {
        await agFileAmicus({ caseId, amicusIdx: chosen });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not file amicus.");
      }
    });
  };

  return (
    <div className="rounded border border-[var(--psc-border)] bg-white/70 p-3 text-xs">
      <p className="font-semibold text-[var(--psc-ink)]">File an amicus brief (4h)</p>
      <p className="mt-1 text-[var(--psc-muted)]">
        Lower-stakes alternative to arguing the merits. Caps at a narrow win on the result.
      </p>
      {error ? <p className="mt-2 rounded border border-red-600 bg-red-50 p-2 text-red-950">{error}</p> : null}
      <ul className="mt-2 space-y-1">
        {options.map((opt, ix) => (
          <li key={opt.id}>
            <label className="flex cursor-pointer items-start gap-2 rounded border border-[var(--psc-border)] bg-white p-2">
              <input
                type="radio"
                name={`amicus-${caseId}`}
                disabled={pending || hoursLeft < 4}
                checked={chosen === ix}
                onChange={() => setChosen(ix)}
                className="mt-0.5"
              />
              <span className="leading-snug">{opt.line}</span>
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={submit}
        disabled={pending || chosen == null || hoursLeft < 4}
        className="mt-2 w-full rounded border-2 border-[var(--psc-accent)] bg-[color-mix(in_srgb,var(--psc-accent)_12%,white)] px-3 py-2 text-xs font-bold uppercase tracking-wide text-[var(--psc-ink)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Filing…" : "File amicus"}
      </button>
    </div>
  );
}

function DeclineForm({ caseId, hoursLeft }: { caseId: string; hoursLeft: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const submit = () => {
    setError(null);
    start(async () => {
      try {
        await agDeclineToDefend({ caseId });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not file decline.");
      }
    });
  };

  return (
    <div className="rounded border border-red-700 bg-red-50/60 p-3 text-xs">
      <p className="font-semibold text-red-950">Decline to defend (2h)</p>
      <p className="mt-1 text-red-900">
        File a notice that the United States declines to defend the existing position. The court will rule against the
        government; any linked law is struck. Substantial public-confidence cost.
      </p>
      {error ? <p className="mt-2 rounded border border-red-600 bg-red-100 p-2 text-red-950">{error}</p> : null}
      {confirming ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending || hoursLeft < 2}
            className="rounded border-2 border-red-700 bg-red-700 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Filing…" : "Confirm decline"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="rounded border border-[var(--psc-border)] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)]"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={pending || hoursLeft < 2}
          className="mt-2 w-full rounded border border-red-700 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-red-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          File decline-to-defend notice
        </button>
      )}
    </div>
  );
}

export function AttorneyGeneralCourtWorkbench({
  cases,
  hoursBudget,
  hoursUsed,
  isAttorneyGeneral,
  isPresident,
}: {
  cases: CourtCaseRow[];
  hoursBudget: number;
  hoursUsed: number;
  isAttorneyGeneral: boolean;
  isPresident: boolean;
}) {
  const hoursLeft = Math.max(0, hoursBudget - hoursUsed);
  const open = useMemo(() => cases.filter((c) => c.status === "open"), [cases]);
  const recent = useMemo(
    () => cases.filter((c) => c.status === "closed" || c.status === "expired").slice(0, 5),
    [cases],
  );

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          Today&apos;s engagement (UTC)
        </h2>
        <p className="mt-2 text-3xl font-mono font-bold text-[var(--psc-ink)]">{hoursLeft}</p>
        <p className="text-sm text-[var(--psc-muted)]">
          hours remaining of {hoursBudget}. Argue a case (8h), file amicus (4h), or decline to defend (2h).
        </p>
      </section>

      <section className="space-y-3">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-[var(--psc-ink)]">Active docket</h2>
          <p className="text-xs text-[var(--psc-muted)]">
            Up to two cases at a time. New cases enter the docket roughly every two days.
          </p>
        </header>

        {open.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-4 text-sm text-[var(--psc-muted)]">
            No active cases. Reload in a moment — the docket clerk opens cases automatically.
          </p>
        ) : null}

        {open.map((c) => (
          <article
            key={c.id}
            className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--psc-muted)]">
                  {c.topic}
                </p>
                <h3 className="text-lg font-semibold text-[var(--psc-ink)]">{c.caseLabel}</h3>
              </div>
              <CountdownBadge closesAt={c.closesAt} />
            </header>
            <p className="mt-2 text-sm leading-relaxed text-[var(--psc-ink)]">{c.factPattern}</p>
            <p className="mt-2 text-xs italic text-[var(--psc-muted)]">
              <span className="font-semibold uppercase tracking-wide not-italic">Question presented:</span>{" "}
              {c.questionPresented}
            </p>

            {c.presidentialDirective ? (
              <div className="mt-3">
                <DirectiveBanner directive={c.presidentialDirective} />
              </div>
            ) : null}

            {isPresident ? (
              <div className="mt-3">
                <PresidentDirectiveControls caseId={c.id} current={c.presidentialDirective} />
              </div>
            ) : null}

            {isAttorneyGeneral && c.agenda ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <form action={startCourtArgument} className="rounded border border-[var(--psc-border)] bg-white/70 p-3">
                  <input type="hidden" name="case_id" value={c.id} />
                  <p className="text-xs font-semibold text-[var(--psc-ink)]">Argue the merits (8h)</p>
                  <p className="mt-1 text-xs text-[var(--psc-muted)]">
                    Three-step oral argument: opening frame, rebuttal, three justice questions.
                  </p>
                  <div className="mt-2 flex flex-col gap-2">
                    <SubmitButton
                      name="side"
                      value="defend"
                      disabled={hoursLeft < 8}
                      title={`Defend: ${c.agenda.defendPosition}`}
                      className="w-full rounded border-2 border-[var(--psc-accent)] bg-[color-mix(in_srgb,var(--psc-accent)_12%,white)] px-3 py-2 text-xs font-bold uppercase tracking-wide text-[var(--psc-ink)]"
                    >
                      Defend → {c.agenda.defendPosition}
                    </SubmitButton>
                    <SubmitButton
                      name="side"
                      value="challenge"
                      disabled={hoursLeft < 8}
                      title={`Challenge: ${c.agenda.challengePosition}`}
                      className="w-full rounded border border-[var(--psc-border)] bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-[var(--psc-ink)]"
                    >
                      Challenge → {c.agenda.challengePosition}
                    </SubmitButton>
                  </div>
                </form>

                <div className="space-y-2">
                  <AmicusForm caseId={c.id} options={c.agenda.amicusOptions} hoursLeft={hoursLeft} />
                  <DeclineForm caseId={c.id} hoursLeft={hoursLeft} />
                </div>
              </div>
            ) : null}

            {!isAttorneyGeneral && !isPresident ? (
              <p className="mt-4 rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-3 text-xs text-[var(--psc-muted)]">
                The Attorney General must argue, file amicus, or decline within the deadline. Cabinet members can review
                the docket for RP context.
              </p>
            ) : null}
          </article>
        ))}
      </section>

      {recent.length > 0 ? (
        <section className="space-y-3">
          <header>
            <h2 className="text-base font-semibold text-[var(--psc-ink)]">Recent rulings</h2>
            <p className="text-xs text-[var(--psc-muted)]">
              Last five disposed cases. Outcomes affected national metrics and DOJ public confidence.
            </p>
          </header>
          <ul className="space-y-2">
            {recent.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/docket/${c.id}`}
                  className="block rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-3 text-sm shadow-sm transition-colors hover:border-[var(--psc-accent)]/40 hover:bg-[var(--psc-canvas)]/40"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-[var(--psc-ink)]">{c.caseLabel}</span>
                    <span className="rounded bg-[var(--psc-canvas)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--psc-ink)]">
                      {c.outcomeTier ? c.outcomeTier.replace(/_/g, " ") : c.status}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--psc-muted)]">
                    {c.topic} · {c.sideTaken ? `Posture: ${c.sideTaken}` : "No appearance"}
                  </p>
                  {c.outcomeSummary ? (
                    <p className="mt-1 line-clamp-4 text-xs leading-relaxed text-[var(--psc-ink)]">{c.outcomeSummary}</p>
                  ) : null}
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-accent)]">
                    Read dispatch →
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
