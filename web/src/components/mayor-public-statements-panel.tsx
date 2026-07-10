"use client";

import { useState } from "react";
import { issueMayorPublicStatement, type MayorActionResult } from "@/app/actions/mayor";
import type { MayorPublicStatementRow } from "@/lib/city-office-data";
import { MAYOR_PUBLIC_STATEMENT_TEMPLATES } from "@/lib/mayor-public-statement-templates";

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

type Props = {
  canMayor: boolean;
  statements: MayorPublicStatementRow[];
  pending: boolean;
  onRun: (fn: () => Promise<MayorActionResult>) => void;
};

export function MayorPublicStatementsPanel({ canMayor, statements, pending, onRun }: Props) {
  const [templateKey, setTemplateKey] = useState("custom");
  const [body, setBody] = useState("");

  function applyTemplate(key: string) {
    setTemplateKey(key);
    const template = MAYOR_PUBLIC_STATEMENT_TEMPLATES.find((t) => t.key === key);
    if (template && key !== "custom") setBody(template.body);
    if (key === "custom") setBody("");
  }

  return (
    <div className="space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <h2 className="font-semibold">Public statements</h2>

      {canMayor ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            onRun(async () => {
              const result = await issueMayorPublicStatement({
                body: body.trim(),
                templateKey: templateKey === "custom" ? null : templateKey,
              });
              if (result.ok) {
                setBody("");
                setTemplateKey("custom");
              }
              return result;
            });
          }}
        >
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-[var(--psc-ink)]">Template</span>
            <select
              className="w-full rounded border border-[var(--psc-border)] bg-[var(--psc-bg)] px-2 py-1.5 text-sm"
              value={templateKey}
              onChange={(e) => applyTemplate(e.target.value)}
            >
              {MAYOR_PUBLIC_STATEMENT_TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-[var(--psc-ink)]">Statement</span>
            <textarea
              rows={5}
              maxLength={4000}
              required
              placeholder="Address the city…"
              className="w-full rounded border border-[var(--psc-border)] bg-[var(--psc-bg)] px-2 py-1.5 text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={pending || !body.trim()}
            className="rounded bg-[var(--psc-accent)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Publish statement
          </button>
        </form>
      ) : null}

      {statements.length > 0 ? (
        <ul className="space-y-3 border-t border-[var(--psc-border)] pt-4">
          {statements.map((stmt) => (
            <li key={stmt.id} className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3 text-sm">
              <p className="text-xs text-[var(--psc-muted)]">
                {stmt.issuerName} · {formatWhen(stmt.createdAt)}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-[var(--psc-ink)]">{stmt.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--psc-muted)]">No public statements yet.</p>
      )}
    </div>
  );
}
