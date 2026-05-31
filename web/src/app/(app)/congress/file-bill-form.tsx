"use client";

import { useRouter } from "next/navigation";
import { submitBill } from "@/app/actions/bills";
import { BillRichTextEditorWithHiddenInput } from "@/components/bill-rich-text-editor";
import { SubmitButton } from "@/components/submit-button";

export function FileBillForm({
  originatingChamber,
}: {
  originatingChamber: "house" | "senate";
}) {
  const router = useRouter();

  async function submitBillThenRefresh(formData: FormData) {
    await submitBill(formData);
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-lg border border-[var(--psc-border)] border-dashed bg-[var(--psc-canvas)]/60 px-3 py-2">
        <p className="text-xs text-[var(--psc-muted)]">
          <span className="font-semibold text-[var(--psc-ink)]">Custom bills only</span> — policy template filing is disabled in baseline mode.
        </p>
      </div>
      <form action={submitBillThenRefresh} className="grid gap-4 md:grid-cols-2">
        <input type="hidden" name="originating_chamber" value={originatingChamber} />
        <label className="grid gap-2 text-sm font-semibold md:col-span-2">
          Title
          <input
            name="title"
            required
            className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
          />
        </label>
        <div className="grid gap-2 text-sm font-semibold md:col-span-2">
          <span>Bill text</span>
          <p className="text-xs font-normal text-[var(--psc-muted)]">
            Use the toolbar for bold, italic, underline, headings, lists, and alignment. Formatting is saved as written.
          </p>
          <BillRichTextEditorWithHiddenInput fieldName="content_html" />
        </div>
        <SubmitButton
          pendingLabel="Filing…"
          className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white md:col-span-2 hover:brightness-110"
        >
          {originatingChamber === "house" ? "File House bill" : "File Senate bill"}
        </SubmitButton>
      </form>
    </div>
  );
}
