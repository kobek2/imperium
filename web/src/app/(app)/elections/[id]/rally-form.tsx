"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { submitCampaignRally } from "@/app/actions/elections";

type Props = {
  electionId: string;
  office: string;
  state: string | null;
  districtCode: string | null;
  used: number;
  limit: number;
  windowHours: number;
  nextUnlockAt: string | null;
  states: Array<{ code: string; name: string }>;
};

// Server-action wrapper that returns a client-friendly { error, ok } instead of throwing so the
// Next.js error overlay never fires when the user just hits the rate limit.
async function rallyAction(
  _prev: { error: string | null; ok: boolean; spent: number },
  formData: FormData,
): Promise<{ error: string | null; ok: boolean; spent: number }> {
  try {
    const qtyRaw = Number(String(formData.get("qty") ?? "1").trim());
    const qty = Math.max(1, Math.min(50, Math.floor(Number.isFinite(qtyRaw) ? qtyRaw : 1)));
    await submitCampaignRally(formData);
    return { error: null, ok: true, spent: qty };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong.";
    return { error: msg, ok: false, spent: 0 };
  }
}

function RallyButton({
  disabled,
  label,
}: {
  disabled: boolean;
  label: string;
}) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      className="w-full rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
    >
      {pending ? "Applying rallies…" : label}
    </button>
  );
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalSeconds = Math.ceil(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function RallyForm({
  electionId,
  office,
  state,
  districtCode,
  used,
  limit,
  windowHours,
  nextUnlockAt,
  states,
}: Props) {
  const [result, formAction] = useActionState(rallyAction, {
    error: null,
    ok: false,
    spent: 0,
  });

  /** Controlled so the presidential target state survives server-action re-renders. */
  const [targetState, setTargetState] = useState("");

  // Live countdown for the "next rally unlocks in…" label.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!nextUnlockAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [nextUnlockAt]);

  const atCap = used >= limit;
  const remaining = Math.max(0, limit - used);
  const pct = Math.min(100, Math.round((used / limit) * 100));

  const nextUnlockMs = nextUnlockAt ? new Date(nextUnlockAt).getTime() - now : 0;
  const nextUnlockLabel =
    atCap && nextUnlockAt && nextUnlockMs > 0
      ? `Next rally unlocks in ${formatCountdown(nextUnlockMs)}`
      : atCap
        ? "Next rally unlocks shortly…"
        : null;

  const needsStatePicker = office === "president";

  const barTone =
    pct >= 100
      ? "bg-red-500"
      : pct >= 80
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <form
      action={formAction}
      className="space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-4"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Rally</h3>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
          +0.5 pts each
        </span>
      </div>

      <p className="text-xs text-[var(--psc-muted)]">
        {office === "house"
          ? `Rallies stay in ${districtCode ?? "your district"}.`
          : office === "senate"
            ? `Rallies stay in ${state ?? "your state"}.`
            : "Choose any state — rallies affect only that state's tally."}
      </p>

      {/* Prominent usage meter */}
      <div className="space-y-1.5 rounded border border-[var(--psc-border)] bg-white p-3">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-semibold text-[var(--psc-ink)]">
            Rallies used this {windowHours}h window
          </span>
          <span className="font-mono text-sm font-bold text-[var(--psc-ink)]">
            {used} / {limit}
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-[var(--psc-canvas)]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={used}
        >
          <div
            className={`h-full transition-all ${barTone}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
          <span className="text-[var(--psc-muted)]">
            {remaining > 0
              ? `${remaining} ${remaining === 1 ? "rally" : "rallies"} left`
              : "You've used every rally in this window."}
          </span>
          {nextUnlockLabel ? (
            <span className="font-mono font-semibold text-[var(--psc-muted)]">
              {nextUnlockLabel}
            </span>
          ) : null}
        </div>
      </div>

      <input type="hidden" name="election_id" value={electionId} />
      {needsStatePicker ? (
        <label className="grid gap-1 text-xs font-semibold">
          Target state
          <select
            name="target_state"
            required
            value={targetState}
            onChange={(e) => setTargetState(e.target.value)}
            className="w-full min-w-0 border border-[var(--psc-border)] bg-white px-2 py-1.5 text-sm font-normal"
          >
            <option value="" disabled>
              Pick a state…
            </option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {office === "house" && districtCode ? (
        <input type="hidden" name="target_district" value={districtCode} />
      ) : null}
      {office === "senate" && state ? (
        <input type="hidden" name="target_state" value={state} />
      ) : null}
      <label className="grid gap-1 text-xs font-semibold text-[var(--psc-ink)]">
        How many rallies
        <input
          name="qty"
          type="number"
          min={1}
          max={Math.max(1, remaining)}
          defaultValue={1}
          className="w-full max-w-xs border border-[var(--psc-border)] bg-white px-2 py-1.5 text-sm font-normal"
        />
      </label>

      <RallyButton
        disabled={atCap}
        label={
          atCap
            ? "Cap reached — try again later"
            : `Apply rallies (+0.5 each · ${remaining} left)`
        }
      />

      {result.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          {result.error}
        </p>
      ) : null}
      {result.ok ? (
        <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {result.spent === 1
            ? "Rally recorded. +0.5 pts added to your total."
            : `${result.spent} rallies recorded. +${(result.spent * 0.5).toFixed(1)} pts added to your total.`}
        </p>
      ) : null}
    </form>
  );
}
