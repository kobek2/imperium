"use client";

import { useState } from "react";
import { issueMayorExecutiveOrder, type MayorActionResult } from "@/app/actions/mayor";
import type { MayorExecutiveOrderRow } from "@/lib/city-office-data";
import { MAYOR_EXECUTIVE_ORDER_TEMPLATES } from "@/lib/mayor-executive-order-templates";

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
  orders: MayorExecutiveOrderRow[];
  pending: boolean;
  onRun: (fn: () => Promise<MayorActionResult>) => void;
};

export function MayorExecutiveOrdersPanel({ canMayor, orders, pending, onRun }: Props) {
  const [templateKey, setTemplateKey] = useState("custom");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  function applyTemplate(key: string) {
    setTemplateKey(key);
    const template = MAYOR_EXECUTIVE_ORDER_TEMPLATES.find((t) => t.key === key);
    if (template && key !== "custom") {
      setTitle(template.title);
      setBody(template.body);
    }
    if (key === "custom") {
      setTitle("");
      setBody("");
    }
  }

  return (
    <div className="space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <h2 className="font-semibold">Executive orders</h2>
      <p className="text-xs text-[var(--psc-muted)]">Flavor / RP only — no budget or metric effects.</p>

      {canMayor ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim() || !body.trim()) return;
            onRun(async () => {
              const result = await issueMayorExecutiveOrder({
                title: title.trim(),
                body: body.trim(),
                templateKey: templateKey === "custom" ? null : templateKey,
              });
              if (result.ok) {
                setTitle("");
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
              {MAYOR_EXECUTIVE_ORDER_TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-[var(--psc-ink)]">Title</span>
            <input
              type="text"
              maxLength={200}
              required
              className="w-full rounded border border-[var(--psc-border)] bg-[var(--psc-bg)] px-2 py-1.5 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-[var(--psc-ink)]">Order text</span>
            <textarea
              rows={6}
              maxLength={8000}
              required
              className="w-full rounded border border-[var(--psc-border)] bg-[var(--psc-bg)] px-2 py-1.5 text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={pending || !title.trim() || !body.trim()}
            className="rounded bg-[var(--psc-accent)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Issue order
          </button>
        </form>
      ) : null}

      {orders.length > 0 ? (
        <ul className="space-y-3 border-t border-[var(--psc-border)] pt-4">
          {orders.map((order) => (
            <li key={order.id} className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3 text-sm">
              <p className="font-medium text-[var(--psc-ink)]">{order.title}</p>
              <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
                {order.issuerName} · {formatWhen(order.createdAt)}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-[var(--psc-muted)]">{order.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--psc-muted)]">No executive orders on file.</p>
      )}
    </div>
  );
}
