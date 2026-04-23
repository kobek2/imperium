"use client";

import { updateBillContent } from "@/app/actions/bills";
import { BillRichTextEditorWithHiddenInput } from "@/components/bill-rich-text-editor";
import { SubmitButton } from "@/components/submit-button";

export function BillLeadershipEditForm({
  billId,
  initialHtml,
}: {
  billId: string;
  initialHtml: string | null;
}) {
  return (
    <form action={updateBillContent} className="mt-6 space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
      <input type="hidden" name="bill_id" value={billId} />
      <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Edit bill text (leadership only)</h2>
      <p className="text-xs text-[var(--psc-muted)]">
        Changes are saved as rich text. Previous versions are kept in history below.
      </p>
      <BillRichTextEditorWithHiddenInput fieldName="content_html" initialHtml={initialHtml} />
      <SubmitButton
        pendingLabel="Saving…"
        className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white hover:brightness-110"
      >
        Save changes
      </SubmitButton>
    </form>
  );
}
