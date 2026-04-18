"use client";

import { useActionState } from "react";
import { withdrawCandidacy } from "@/app/actions/elections";
import { SubmitButton } from "@/components/submit-button";

async function withdrawAction(
  _prev: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  try {
    await withdrawCandidacy(formData);
    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not withdraw filing.";
    return { error: msg };
  }
}

export function WithdrawFilingForm({ electionId }: { electionId: string }) {
  const [state, formAction] = useActionState(withdrawAction, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="election_id" value={electionId} />
      <SubmitButton
        variant="ghost"
        pendingLabel="Withdrawing…"
        className="w-full rounded border border-amber-800/40 bg-amber-50/80 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-950 transition hover:bg-amber-100"
      >
        Withdraw filing
      </SubmitButton>
      {state.error ? (
        <p className="text-[10px] text-red-700">{state.error}</p>
      ) : null}
    </form>
  );
}
