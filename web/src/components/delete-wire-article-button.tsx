"use client";

import { deleteWireArticle } from "@/app/actions/simulation-events";
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

export function DeleteWireArticleButton({ instanceId }: { instanceId: string }) {
  return (
    <form
      action={deleteWireArticle}
      className="inline-flex"
      onSubmit={(e) => {
        if (!confirm("Delete this article from the newsroom? Assignments for this story are removed too.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="instance_id" value={instanceId} />
      <SubmitButton
        pendingLabel="…"
        title="Delete article"
        className="inline-flex h-8 w-8 items-center justify-center rounded border border-transparent text-red-700 transition hover:border-red-200 hover:bg-red-50 disabled:opacity-50"
      >
        <span className="sr-only">Delete article</span>
        <TrashIcon />
      </SubmitButton>
    </form>
  );
}
