"use client";

import Link from "next/link";
import type { RivalIntelRow } from "@/lib/campaign-manager-data";

function kindLabel(kind: string): string {
  if (kind === "pac_counter") return "Counter-spend";
  if (kind === "pac_spend") return "Rival PAC";
  if (kind === "bill_filed") return "Legislation";
  if (kind === "whip") return "Whip";
  if (kind === "bribe") return "Bribe";
  if (kind === "round_advance") return "Phase";
  if (kind === "law_signed") return "Signed";
  if (kind === "law_vetoed") return "Vetoed";
  if (kind === "leadership") return "Leadership";
  if (kind === "daily_refill") return "War chest";
  return "Intel";
}

function kindTone(kind: string): string {
  if (kind === "pac_counter" || kind === "pac_spend" || kind === "law_vetoed") {
    return "text-red-700 bg-red-50 border-red-200";
  }
  if (kind === "bill_filed" || kind === "leadership") return "text-amber-800 bg-amber-50 border-amber-200";
  if (kind === "law_signed") return "text-emerald-800 bg-emerald-50 border-emerald-200";
  if (kind === "whip" || kind === "bribe") return "text-blue-800 bg-blue-50 border-blue-200";
  if (kind === "daily_refill" || kind === "round_advance") return "text-slate-600 bg-slate-50 border-slate-200";
  return "text-[var(--psc-muted)] bg-[var(--psc-canvas)] border-[var(--psc-border)]";
}

export function WarRoomIntelFeed({ rows }: { rows: RivalIntelRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
        <h3 className="text-sm font-semibold">Rival intel</h3>
        <p className="mt-2 text-sm text-[var(--psc-muted)]">
          No rival activity logged yet. Once you spend PAC money or the daily cycle runs, counter-moves appear here.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <h3 className="text-sm font-semibold">Rival intel feed</h3>
      <p className="mt-0.5 text-xs text-[var(--psc-muted)]">What the machine did — updated as it reacts to you.</p>
      <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto text-sm">
        {rows.map((row, i) => (
          <li
            key={row.id}
            className={`flex gap-3 rounded border px-3 py-2 ${
              i === 0 ? "border-[var(--psc-seal)]/40 bg-[var(--psc-canvas)]/60" : "border-[var(--psc-border)]/60 bg-[var(--psc-canvas)]/40"
            }`}
          >
            <span
              className={`shrink-0 self-start rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${kindTone(row.kind)}`}
            >
              {kindLabel(row.kind)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[var(--psc-ink)]">{row.summary}</p>
              <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
                {new Date(row.createdAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {typeof row.metadata.bill_id === "string" ? (
                  <>
                    {" · "}
                    <Link href={`/bill/${row.metadata.bill_id}`} className="underline underline-offset-2">
                      View bill
                    </Link>
                  </>
                ) : null}
                {typeof row.metadata.election_id === "string" ? (
                  <>
                    {" · "}
                    <Link href={`/elections/${row.metadata.election_id}`} className="underline underline-offset-2">
                      View race
                    </Link>
                  </>
                ) : null}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
