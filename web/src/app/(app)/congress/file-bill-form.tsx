"use client";

import { useEffect, useState } from "react";
import { submitBill } from "@/app/actions/bills";
import { listBillTemplates, type BillTemplateRow } from "@/app/actions/bill-templates";
import { BillRichTextEditorWithHiddenInput } from "@/components/bill-rich-text-editor";
import { SubmitButton } from "@/components/submit-button";
import { legacyMdToEditorHtml, sanitizeBillHtml } from "@/lib/sanitize-bill-html";

type Stance = {
  stance_key: string;
  label: string;
  summary: string;
  full_text: string;
  policy_value: number;
};

function parseStances(raw: unknown): Stance[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(Boolean) as Stance[];
}

function spectrumPct(policyValue: number): number {
  return Math.max(0, Math.min(100, ((policyValue + 2) / 4) * 100));
}

function normalizeOfficialStanceLabel(label: string): string {
  return label.replaceAll(" + ", " and ").replaceAll("+", " and ").trim();
}

export function FileBillForm({ originatingChamber }: { originatingChamber: "house" | "senate" }) {
  const [mode, setMode] = useState<"free" | "template">("free");
  const [templates, setTemplates] = useState<BillTemplateRow[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<BillTemplateRow | null>(null);
  const [stance, setStance] = useState<Stance | null>(null);

  useEffect(() => {
    void listBillTemplates().then(setTemplates);
  }, []);

  const policyTagsJson =
    selectedTpl && stance
      ? JSON.stringify({
          issue_key: selectedTpl.issue_key,
          stance_key: stance.stance_key,
          policy_value: stance.policy_value,
        })
      : "";

  const modeToggle = (
    <div className="flex flex-wrap gap-2 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-2 text-sm">
      <button
        type="button"
        className={`rounded px-3 py-1.5 font-semibold ${
          mode === "free" ? "bg-[var(--psc-ink)] text-white" : "text-[var(--psc-muted)]"
        }`}
        onClick={() => setMode("free")}
      >
        Write my own bill
      </button>
      <button
        type="button"
        className={`rounded px-3 py-1.5 font-semibold ${
          mode === "template" ? "bg-[var(--psc-ink)] text-white" : "text-[var(--psc-muted)]"
        }`}
        onClick={() => {
          setMode("template");
          setSelectedTpl(null);
          setStance(null);
        }}
      >
        Change Policy
      </button>
    </div>
  );

  if (mode === "free") {
    return (
      <div className="mt-4 space-y-4">
        {modeToggle}
        <form action={submitBill} className="grid gap-4 md:grid-cols-2">
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
              Use the toolbar for bold, italic, underline, headings, lists, and alignment. Formatting is saved as
              written.
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

  const stances = selectedTpl ? parseStances(selectedTpl.stances) : [];

  return (
    <div className="mt-4 space-y-4">
      {modeToggle}

      {!selectedTpl ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 text-left transition hover:border-[var(--psc-accent)]"
              onClick={() => {
                setSelectedTpl(t);
                setStance(null);
              }}
            >
              <p className="text-sm font-semibold text-[var(--psc-ink)]">{t.display_name}</p>
              <p className="mt-1 text-xs text-[var(--psc-muted)]">{t.description}</p>
            </button>
          ))}
        </div>
      ) : !stance ? (
        <div className="space-y-3">
          <button
            type="button"
            className="text-xs font-semibold text-[var(--psc-accent)] underline"
            onClick={() => setSelectedTpl(null)}
          >
            ← Back to issues
          </button>
          <p className="text-sm font-semibold text-[var(--psc-ink)]">Choose a stance for {selectedTpl.display_name}</p>
          <div className="grid gap-3">
            {stances.map((s) => (
              <label
                key={s.stance_key}
                className="flex cursor-pointer gap-3 rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 has-[:checked]:border-[var(--psc-accent)]"
              >
                <input
                  type="radio"
                  name="stance_pick"
                  className="mt-1"
                  checked={false}
                  onChange={() => setStance(s)}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-semibold text-[var(--psc-ink)]">{s.label}</span>
                  <span className="mt-1 block text-xs text-[var(--psc-muted)]">{s.summary}</span>
                  <span className="mt-2 block">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                      Policy position
                    </span>
                    <span className="relative mt-1 block h-2 w-full rounded-full bg-gradient-to-r from-red-500 via-slate-300 to-blue-600">
                      <span
                        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--psc-ink)] shadow"
                        style={{ left: `${spectrumPct(s.policy_value)}%` }}
                      />
                    </span>
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : (
        <form action={submitBill} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="originating_chamber" value={originatingChamber} />
          <input type="hidden" name="template_id" value={selectedTpl.id} />
          <input type="hidden" name="policy_tags_json" value={policyTagsJson} />
          <input type="hidden" name="template_core_md" value={stance.full_text} />

          <button
            type="button"
            className="text-left text-xs font-semibold text-[var(--psc-accent)] underline md:col-span-2"
            onClick={() => setStance(null)}
          >
            ← Change stance
          </button>

          <label className="grid gap-2 text-sm font-semibold md:col-span-2">
            Title
            <input
              key={stance.stance_key}
              name="title"
              required
              defaultValue={`${selectedTpl.display_name} Act — ${normalizeOfficialStanceLabel(stance.label)}`}
              className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
            />
          </label>

          <div className="grid gap-2 text-sm font-semibold md:col-span-2">
            <span>Optional preamble / personal statement</span>
            <p className="text-xs font-normal text-[var(--psc-muted)]">
              Appears before the statutory template text. The template text itself cannot be changed.
            </p>
            <BillRichTextEditorWithHiddenInput fieldName="preamble_html" />
          </div>

          <div className="md:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
              Statutory text (read-only)
            </p>
            <div
              className="mt-2 max-h-80 overflow-y-auto rounded border border-[var(--psc-border)] bg-white p-3 text-sm [&_p]:mb-2"
              dangerouslySetInnerHTML={{
                __html: sanitizeBillHtml(legacyMdToEditorHtml(stance.full_text) ?? ""),
              }}
            />
          </div>

          <SubmitButton
            pendingLabel="Filing…"
            className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white md:col-span-2 hover:brightness-110"
          >
            {originatingChamber === "house" ? "File House bill" : "File Senate bill"}
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
