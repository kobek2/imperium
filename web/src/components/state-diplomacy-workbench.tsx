"use client";

import { useMemo } from "react";
import { startIntensiveDiplomacyDialogue, stateSpendPassiveDiplomacy } from "@/app/actions/diplomacy";
import { SubmitButton } from "@/components/submit-button";

type NationRow = { code: string; name: string; us_relation: number };

const MOCK_CRISIS_NATIONS: NationRow[] = [
  { code: "PRE", name: "Preview Republic", us_relation: 4 },
  { code: "VW", name: "Viewport Partner State", us_relation: 10 },
];

function CriticalBilateralStandingBanner({
  nations,
  preview,
}: {
  nations: NationRow[];
  preview?: boolean;
}) {
  const frame = preview
    ? "border-dashed border-amber-700 bg-amber-50/90"
    : "border-amber-600 bg-amber-50";

  return (
    <div className={`rounded-lg border-2 p-4 text-sm text-amber-950 ${frame}`} role="status">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">Critical bilateral standing</p>
        {preview ? (
          <span className="rounded bg-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950">
            UI preview
          </span>
        ) : null}
      </div>
      <p className="mt-1">
        {nations.map((n) => `${n.name} (${n.us_relation})`).join(" · ")} — a Situation Room-grade thread is appropriate;
        all principals have been alerted in their inboxes.
      </p>
      {preview ? (
        <p className="mt-2 text-xs text-amber-900/80">
          Not live data. Set{" "}
          <code className="rounded bg-amber-100/80 px-1 font-mono text-[11px]">NEXT_PUBLIC_DIPLOMACY_CRISIS_WARNING_MOCK=1</code>{" "}
          in <code className="rounded bg-amber-100/80 px-1 font-mono text-[11px]">.env.local</code> to show this when no
          partner is actually at the floor; remove the line when you are done.
        </p>
      ) : null}
    </div>
  );
}

export function StateDiplomacyWorkbench({
  nations,
  hoursBudget,
  hoursUsed,
  canAct,
  mockCrisisWarning = false,
}: {
  nations: NationRow[];
  hoursBudget: number;
  hoursUsed: number;
  canAct: boolean;
  /** When true and no live crisis row, shows the same banner with sample names (dev / layout). */
  mockCrisisWarning?: boolean;
}) {
  const hoursLeft = Math.max(0, hoursBudget - hoursUsed);

  const crisisNations = useMemo(() => nations.filter((n) => n.us_relation <= 10), [nations]);
  const showLiveCrisis = crisisNations.length > 0;
  const showMockCrisis = !showLiveCrisis && mockCrisisWarning;

  return (
    <div className="space-y-8">
      {showLiveCrisis ? <CriticalBilateralStandingBanner nations={crisisNations} /> : null}
      {showMockCrisis ? <CriticalBilateralStandingBanner nations={MOCK_CRISIS_NATIONS} preview /> : null}

      <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Today&apos;s calendar (UTC)</h2>
        <p className="mt-2 text-3xl font-mono font-bold text-[var(--psc-ink)]">{hoursLeft}</p>
        <p className="text-sm text-[var(--psc-muted)]">
          hours remaining of {hoursBudget}. Resets at each UTC midnight for cabinet engagement.
        </p>
      </section>

      <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Partner relationships</h2>
        <p className="mt-1 text-xs text-[var(--psc-muted)]">
          Scale 0 (hostile) to 100 (strong alignment). Standing slips ~10 points per UTC day unless the Secretary invests
          time.
        </p>
        <ul className="mt-4 space-y-4">
          {nations.map((n) => {
            const pct = n.us_relation;
            return (
              <li key={n.code} className="space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--psc-ink)]">
                    {n.name}{" "}
                    <span className="font-mono text-xs font-normal text-[var(--psc-muted)]">({n.code})</span>
                  </span>
                  <span className="font-mono text-sm text-[var(--psc-ink)]">{n.us_relation}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--psc-border)]">
                  <div
                    className="h-full rounded-full bg-[var(--psc-accent)] transition-[width]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {!canAct ? (
        <p className="rounded-lg border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-4 text-sm text-[var(--psc-muted)]">
          Only the Secretary of State may commit outreach hours or run dialogues from this station. Other cabinet members
          and principals can review the tracker for RP context.
        </p>
      ) : null}

      {canAct ? (
        <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Passive bilateral desk time</h2>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Abstract blocks (briefings, desk work, sherpas) — <strong>not</strong> the branching dialogue. Each option adds
            a fixed bump to the 0–100 relationship score: <strong>2h → +2</strong>, <strong>4h → +4</strong>,{" "}
            <strong>6h → +7</strong>, <strong>8h → +10</strong> (then clamped to 100). No choice matrix; time spent is the
            only input.
          </p>
          <form action={stateSpendPassiveDiplomacy} className="mt-4 space-y-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
              Nation
              <select
                name="nation_code"
                required
                className="mt-1 w-full rounded border border-[var(--psc-border)] bg-white px-3 py-2 text-sm text-[var(--psc-ink)]"
              >
                <option value="">Select…</option>
                {nations.map((n) => (
                  <option key={n.code} value={n.code}>
                    {n.name} ({n.code})
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Hours</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {([2, 4, 6, 8] as const).map((h) => (
                  <label key={h} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name="hours" value={h} required defaultChecked={h === 4} />
                    {h}h
                  </label>
                ))}
              </div>
            </fieldset>
            <SubmitButton
              disabled={hoursLeft < 2}
              className="inline-flex w-full items-center justify-center rounded-md border-2 border-[var(--psc-accent)] bg-[color-mix(in_srgb,var(--psc-accent)_12%,white)] px-3 py-2 text-sm font-bold text-[var(--psc-ink)]"
            >
              Commit passive outreach
            </SubmitButton>
          </form>
        </section>
      ) : null}

      {canAct ? (
        <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Intensive bilateral (story mode)</h2>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Opens a dedicated dialogue screen (Hall of Fame–style cards). Uses <strong>8 hours</strong> when you finish the
            scene. Your answers are scored as <strong>aligned</strong>, <strong>neutral</strong>, or <strong>tension</strong>{" "}
            relative to the host government&apos;s stated priorities.
          </p>
          <form action={startIntensiveDiplomacyDialogue} className="mt-4 space-y-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
              Nation
              <select
                name="nation_code"
                required
                disabled={hoursLeft < 8}
                className="mt-1 w-full rounded border border-[var(--psc-border)] bg-white px-3 py-2 text-sm text-[var(--psc-ink)] disabled:opacity-50"
              >
                <option value="">Select…</option>
                {nations.map((n) => (
                  <option key={n.code} value={n.code}>
                    {n.name} ({n.code})
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton
              disabled={hoursLeft < 8}
              className="inline-flex w-full items-center justify-center rounded-md border-2 border-[var(--psc-accent)] bg-[color-mix(in_srgb,var(--psc-accent)_12%,white)] px-3 py-2 text-sm font-bold text-[var(--psc-ink)]"
            >
              Enter bilateral room (8h)
            </SubmitButton>
          </form>
        </section>
      ) : null}
    </div>
  );
}
