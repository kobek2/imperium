"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { submitCampaignSpeech } from "@/app/actions/elections";
import { SpeechTextareaWithCounter } from "./speech-textarea-with-counter";

type Props = {
  electionId: string;
  office: string;
  state: string | null;
  districtCode: string | null;
  states: Array<{ code: string; name: string }>;
};

async function speechAction(
  _prev: { error: string | null; ok: boolean; npc_speech: boolean; npc_counter_attack: boolean },
  formData: FormData,
): Promise<{ error: string | null; ok: boolean; npc_speech: boolean; npc_counter_attack: boolean }> {
  try {
    const pulse = await submitCampaignSpeech(formData);
    return { error: null, ok: true, ...pulse };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong.";
    return { error: msg, ok: false, npc_speech: false, npc_counter_attack: false };
  }
}

function SpeechButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Delivering…" : "Deliver speech (+5 pts)"}
    </button>
  );
}

export function SpeechForm({
  electionId,
  office,
  state,
  districtCode,
  states,
}: Props) {
  const [result, formAction] = useActionState(speechAction, {
    error: null,
    ok: false,
    npc_speech: false,
    npc_counter_attack: false,
  });

  const needsStatePicker = false;

  return (
    <form
      action={formAction}
      className="space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-4"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Speech</h3>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
          +5 pts each
        </span>
      </div>
      <p className="text-xs text-[var(--psc-muted)]">
        Minimum 200 words. Pasting is disabled — type your speech yourself.
        {office === "house"
          ? ` It attributes to ${districtCode ?? "this district"}.`
          : office === "senate"
            ? ` It attributes to ${state ?? "this state"}.`
            : " National race — points count toward your ticket total."}
      </p>

      <input type="hidden" name="election_id" value={electionId} />
      {needsStatePicker ? (
        <label className="grid gap-1 text-xs font-semibold">
          Target state
          <select
            name="target_state"
            required
            defaultValue=""
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

      <SpeechTextareaWithCounter
        name="content"
        rows={8}
        placeholder="Write your speech (min 200 words)…"
        className="w-full min-h-[10rem] resize-vertical rounded border border-[var(--psc-border)] bg-white p-2 text-sm outline-none focus:border-[var(--psc-accent)]"
      />

      <SpeechButton />

      {result.error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          {result.error}
        </p>
      ) : null}
      {result.ok ? (
        <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Speech delivered. +5 pts added to your total.
          {result.npc_speech ? " Your opponent just gave a speech." : ""}
          {result.npc_counter_attack ? " They ran a reactive attack ad against you." : ""}
        </p>
      ) : null}
    </form>
  );
}
