"use client";

import { useFormStatus } from "react-dom";

type VoteChoice = "yea" | "nay" | "abstain";

function voteButtonClass(isSelected: boolean, vote: VoteChoice, pending: boolean) {
  const disabled = pending ? "cursor-not-allowed opacity-70" : "";
  if (!isSelected) {
    return `flex-1 border border-[var(--psc-border)] bg-white px-2 py-1 text-xs font-semibold uppercase transition hover:bg-[var(--psc-canvas)] ${disabled}`;
  }
  if (vote === "yea") {
    return `flex-1 border border-green-800 bg-green-100 px-2 py-1 text-xs font-semibold uppercase text-green-900 ring-2 ring-green-700/40 ${disabled}`;
  }
  if (vote === "nay") {
    return `flex-1 border border-red-800 bg-red-100 px-2 py-1 text-xs font-semibold uppercase text-red-900 ring-2 ring-red-700/40 ${disabled}`;
  }
  return `flex-1 border border-amber-800 bg-amber-100 px-2 py-1 text-xs font-semibold uppercase text-amber-900 ring-2 ring-amber-700/40 ${disabled}`;
}

export function FileBillSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border border-[var(--psc-border)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:opacity-70 md:col-span-2"
    >
      {pending ? "Filing..." : "File bill"}
    </button>
  );
}

export function VoteButtons({ selectedVote }: { selectedVote: VoteChoice | null }) {
  const { pending } = useFormStatus();
  return (
    <div className="mt-2 flex gap-2">
      {(["yea", "nay", "abstain"] as const).map((vote) => (
        <button
          key={vote}
          type="submit"
          name="vote"
          value={vote}
          disabled={pending}
          className={voteButtonClass(selectedVote === vote, vote, pending)}
        >
          {pending && selectedVote === vote ? "Saving..." : vote}
        </button>
      ))}
    </div>
  );
}