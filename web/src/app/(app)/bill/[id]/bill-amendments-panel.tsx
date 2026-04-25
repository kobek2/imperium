"use client";

import { useMemo, useState } from "react";
import { proposeBillAmendment, resolveBillAmendment } from "@/app/actions/amendments";
import { BillRichTextEditorWithHiddenInput } from "@/components/bill-rich-text-editor";
import { SubmitButton } from "@/components/submit-button";

export type AmendmentRow = {
  id: string;
  title: string;
  description: string;
  amended_text: string | null;
  status: string;
  proposed_at: string;
  proposed_by: string;
  notes: string | null;
};

export function BillAmendmentsPanel({
  billId,
  status,
  amendments,
  canPropose,
  canResolve,
  initialBillHtml,
}: {
  billId: string;
  status: string;
  amendments: AmendmentRow[];
  canPropose: boolean;
  canResolve: boolean;
  initialBillHtml: string | null;
}) {
  const [open, setOpen] = useState(false);
  const pending = useMemo(() => amendments.filter((a) => a.status === "pending"), [amendments]);

  if (status !== "debate" && status !== "other_chamber_debate") return null;

  return (
    <section className="space-y-4 rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
      <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Amendments</h2>
      {pending.length > 0 ? (
        <p className="text-xs font-semibold text-amber-900">
          {pending.length} pending — leadership must resolve before opening a floor vote.
        </p>
      ) : (
        <p className="text-xs text-[var(--psc-muted)]">No pending amendments.</p>
      )}

      <ul className="space-y-3">
        {amendments.map((a) => (
          <li key={a.id} className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-3 text-xs">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-[var(--psc-ink)]">{a.title}</p>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  a.status === "pending"
                    ? "bg-amber-100 text-amber-900"
                    : a.status === "adopted"
                      ? "bg-green-100 text-green-900"
                      : a.status === "rejected"
                        ? "bg-red-100 text-red-900"
                        : "bg-slate-100 text-slate-800"
                }`}
              >
                {a.status}
              </span>
            </div>
            <p className="mt-1 text-[var(--psc-muted)]">{a.description}</p>
            {a.status === "adopted" && a.amended_text ? (
              <details className="mt-2">
                <summary className="cursor-pointer font-semibold text-[var(--psc-accent)]">View adopted text</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-[var(--psc-border)] bg-white p-2 text-[11px]">
                  {a.amended_text}
                </pre>
              </details>
            ) : null}
            {canResolve && a.status === "pending" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={resolveBillAmendment} className="inline">
                  <input type="hidden" name="amendment_id" value={a.id} />
                  <input type="hidden" name="decision" value="adopt" />
                  <SubmitButton className="rounded border border-green-700 bg-green-700 px-2 py-1 text-[10px] font-semibold uppercase text-white">
                    Adopt
                  </SubmitButton>
                </form>
                <form action={resolveBillAmendment} className="inline">
                  <input type="hidden" name="amendment_id" value={a.id} />
                  <input type="hidden" name="decision" value="reject" />
                  <SubmitButton className="rounded border border-red-700 bg-white px-2 py-1 text-[10px] font-semibold uppercase text-red-800">
                    Reject
                  </SubmitButton>
                </form>
                <form action={resolveBillAmendment} className="inline">
                  <input type="hidden" name="amendment_id" value={a.id} />
                  <input type="hidden" name="decision" value="table" />
                  <SubmitButton className="rounded border border-slate-400 bg-white px-2 py-1 text-[10px] font-semibold uppercase text-slate-800">
                    Table
                  </SubmitButton>
                </form>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {canPropose ? (
        <div>
          <button
            type="button"
            className="text-xs font-semibold text-[var(--psc-accent)] underline"
            onClick={() => setOpen(!open)}
          >
            {open ? "Cancel" : "Propose amendment"}
          </button>
          {open ? (
            <form action={proposeBillAmendment} className="mt-3 grid gap-3 border-t border-[var(--psc-border)] pt-3">
              <input type="hidden" name="bill_id" value={billId} />
              <label className="grid gap-1 text-xs font-semibold">
                Short title
                <input name="title" required className="border border-[var(--psc-border)] bg-white px-2 py-1" />
              </label>
              <label className="grid gap-1 text-xs font-semibold">
                Plain-English description
                <textarea
                  name="description"
                  required
                  rows={3}
                  className="border border-[var(--psc-border)] bg-white px-2 py-1"
                />
              </label>
              <div className="grid gap-1 text-xs font-semibold">
                Amended bill text
                <BillRichTextEditorWithHiddenInput
                  fieldName="amended_content_html"
                  initialHtml={initialBillHtml ?? undefined}
                />
              </div>
              <SubmitButton className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold text-white">
                Submit amendment
              </SubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
