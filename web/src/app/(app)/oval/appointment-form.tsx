"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createAppointment } from "@/app/actions/bills";
import { POLITICAL_ROLE_LABELS } from "@/config/political-roles";
import { CABINET_APPOINTMENT_ROLE_KEYS } from "@/config/cabinet-appointment-roles";
import { SubmitButton } from "@/components/submit-button";

async function transmitNominationAction(
  _prev: { error: string | null; ok: boolean },
  formData: FormData,
): Promise<{ error: string | null; ok: boolean }> {
  try {
    await createAppointment(formData);
    return { error: null, ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong.";
    return { error: msg, ok: false };
  }
}

export function OvalAppointmentForm() {
  const [kind, setKind] = useState("cabinet");
  const [result, formAction] = useActionState(transmitNominationAction, {
    error: null,
    ok: false,
  });

  return (
    <form action={formAction} className="mt-4 grid gap-4 md:grid-cols-2">
      <label className="grid gap-2 text-sm font-semibold md:col-span-2">
        Kind
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
        >
          <option value="cabinet">Cabinet</option>
          <option value="scotus">Supreme Court</option>
          <option value="other">Other</option>
        </select>
      </label>

      {kind === "cabinet" ? (
        <label className="grid gap-2 text-sm font-semibold md:col-span-2">
          Cabinet position
          <select
            name="cabinet_role"
            required
            defaultValue=""
            className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
          >
            <option value="" disabled>
              Select a cabinet seat…
            </option>
            {CABINET_APPOINTMENT_ROLE_KEYS.map((key) => (
              <option key={key} value={key}>
                {POLITICAL_ROLE_LABELS[key] ?? key}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="grid gap-2 text-sm font-semibold md:col-span-2">
          Office title
          <input
            name="title"
            required
            className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
          />
        </label>
      )}

      <label className="grid gap-2 text-sm font-semibold md:col-span-2">
        <span>Nominee Discord user id</span>
        <span className="text-[11px] font-normal text-[var(--psc-muted)]">
          Paste the nominee&apos;s numeric Discord ID (Discord calls this a &quot;snowflake&quot;). It
          is just the ID format — not a status. Find it: User profile → right‑click → Copy User ID
          (Developer Mode on). They must have logged into Imperium at least once.
        </span>
        <input
          name="nominee_discord"
          required
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 987654321098765432"
          className="border border-[var(--psc-border)] bg-white px-3 py-2 font-mono text-sm"
        />
      </label>

      <SubmitButton
        pendingLabel="Transmitting…"
        className="border border-[var(--psc-border)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white md:col-span-2"
      >
        Transmit nomination
      </SubmitButton>

      {result.error ? (
        <p className="md:col-span-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          {result.error}
        </p>
      ) : null}
      {result.ok ? (
        <p className="md:col-span-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Nomination filed. A confirmation bill is in the hopper — Senate leadership should open
          the{" "}
          <Link href="/congress/leadership" className="font-semibold text-emerald-900 underline">
            Leadership inbox
          </Link>{" "}
          to accept or reject, then the bill appears on the Senate floor for a vote.
        </p>
      ) : null}
    </form>
  );
}
