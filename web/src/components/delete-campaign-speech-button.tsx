"use client";

import { deleteCampaignSpeech } from "@/app/actions/elections";
import { SubmitButton } from "@/components/submit-button";

function TrashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function DeleteCampaignSpeechButton({
  speechId,
  electionId,
}: {
  speechId: string;
  electionId: string;
}) {
  return (
    <form
      action={deleteCampaignSpeech}
      className="inline-flex"
      onSubmit={(e) => {
        if (
          !confirm(
            "Delete this speech? Campaign points will be removed. For closed presidential races, recertify the electoral winner if needed.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="speech_id" value={speechId} />
      <input type="hidden" name="election_id" value={electionId} />
      <SubmitButton
        pendingLabel="…"
        title="Delete speech"
        className="inline-flex h-8 w-8 items-center justify-center rounded border border-transparent text-red-700 transition hover:border-red-200 hover:bg-red-50 disabled:opacity-50"
      >
        <span className="sr-only">Delete speech</span>
        <TrashIcon />
      </SubmitButton>
    </form>
  );
}
