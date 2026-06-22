"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { discloseCompanyBillPosition } from "@/app/actions/economy";
import { COMPANY_BILL_POSITIONS } from "@/lib/legislation-stock";

export function CompanyBillPositionForm({
  billId,
  companies,
  existing,
}: {
  billId: string;
  companies: Array<{ id: string; name: string; ticker_symbol: string | null }>;
  existing: Array<{ company_id: string; position: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const existingByCompany = Object.fromEntries(existing.map((e) => [e.company_id, e.position]));

  if (companies.length === 0) return null;

  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <h3 className="text-sm font-semibold">Company position on this bill</h3>
      <p className="mt-1 text-xs text-[var(--psc-muted)]">
        Founders may publicly disclose whether their company supports or opposes this legislation. This is informational
        only and does not affect votes.
      </p>
      {flash ? <p className="mt-2 text-xs">{flash}</p> : null}
      <ul className="mt-3 space-y-3">
        {companies.map((c) => (
          <li key={c.id} className="rounded border border-[var(--psc-border)] p-3 text-sm">
            <p className="font-medium">
              {c.name}
              {c.ticker_symbol ? <span className="ml-1 font-mono text-xs text-[var(--psc-muted)]">({c.ticker_symbol})</span> : null}
            </p>
            {existingByCompany[c.id] ? (
              <p className="mt-1 text-xs text-[var(--psc-muted)]">
                Current position: <span className="font-semibold capitalize">{existingByCompany[c.id]}</span>
              </p>
            ) : null}
            <form
              className="mt-2 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                fd.set("company_id", c.id);
                fd.set("bill_id", billId);
                start(async () => {
                  setFlash(null);
                  const r = await discloseCompanyBillPosition(fd);
                  setFlash(r.message);
                  if (r.ok) router.refresh();
                });
              }}
            >
              <select name="position" defaultValue={existingByCompany[c.id] ?? "support"} className="border border-[var(--psc-border)] px-2 py-1 text-xs">
                {COMPANY_BILL_POSITIONS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={pending}
                className="rounded border border-[var(--psc-ink)] px-3 py-1 text-xs font-medium disabled:opacity-50"
              >
                Disclose
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
