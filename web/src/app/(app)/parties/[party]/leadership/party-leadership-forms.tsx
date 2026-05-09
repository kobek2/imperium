"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { partySetMemberCollectLevyRate } from "@/app/actions/party-leadership";

export type PartyLevyAnalytics = {
  memberFlows: Array<{
    user_id: string;
    character_name: string;
    withheld_total: number;
    salary_base?: number;
    received_total?: number;
    donated_total?: number;
  }>;
};

function clampLevyDecimal(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(0.25, n);
}

function fmtUsd0(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function memberSalaryBase(row: { withheld_total: number; salary_base?: number }, savedRate: number): number {
  const b = Number(row.salary_base);
  if (Number.isFinite(b) && b > 0) return b;
  if (savedRate > 0) return Number(row.withheld_total ?? 0) / savedRate;
  return 0;
}

export function PartyLeadershipForms({
  partyKey,
  isChair,
  memberCollectLevyRate,
  levyAnalytics,
}: {
  partyKey: string;
  isChair: boolean;
  /** Fraction 0–0.25 of each member's government salary slice of hourly collect (RPC-enforced; chair only). */
  memberCollectLevyRate: number;
  /** Salary levy aggregates + per-member rows, visible to all officers. */
  levyAnalytics: PartyLevyAnalytics | null;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [levyDraftStr, setLevyDraftStr] = useState(() => String(memberCollectLevyRate));

  const parsedDraft = Number.parseFloat(levyDraftStr.trim());
  const previewRate = clampLevyDecimal(Number.isFinite(parsedDraft) ? parsedDraft : 0);
  const displayRate = isChair ? previewRate : memberCollectLevyRate;

  return (
    <div className="space-y-8">
      {msg ? (
        <p className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-4 py-3 text-sm text-[var(--psc-ink)]">
          {msg}
        </p>
      ) : null}

      <section className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <div>
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Party salary levy (automatic)</h2>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Auto-withheld from each affiliated member&apos;s government salary on hourly collects and credited to the
            party treasury. Only the chair can change the rate; vice chair and treasurer have read-only access.
          </p>
        </div>

        {isChair ? (
          <form
            className="flex flex-wrap items-end gap-3 border-t border-[var(--psc-border)] pt-4 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              start(async () => {
                setMsg(null);
                const r = await partySetMemberCollectLevyRate(fd);
                setMsg(r.message);
                if (r.ok) router.refresh();
              });
            }}
          >
            <input type="hidden" name="party_key" value={partyKey} />
            <label className="grid gap-1 font-semibold">
              Salary levy rate (decimal, max 0.25)
              <input
                name="member_collect_levy_rate"
                type="number"
                step="0.005"
                min={0}
                max={0.25}
                value={levyDraftStr}
                onChange={(e) => setLevyDraftStr(e.target.value)}
                required
                className="w-40 border border-[var(--psc-border)] px-2 py-2 font-mono text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className="rounded border border-[var(--psc-ink)] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)]"
            >
              Save levy
            </button>
          </form>
        ) : (
          <div className="border-t border-[var(--psc-border)] pt-4 text-sm text-[var(--psc-muted)]">
            <p>
              Current rate:{" "}
              <span className="font-mono font-semibold text-[var(--psc-ink)]">{memberCollectLevyRate}</span> (
              {(memberCollectLevyRate * 100).toFixed(2)}%). Only the chair can change this value.
            </p>
          </div>
        )}

        {isChair ? (
          <p className="text-xs text-[var(--psc-muted)]">
            Saved rate:{" "}
            <span className="font-mono font-semibold text-[var(--psc-ink)]">{memberCollectLevyRate}</span> (
            {(memberCollectLevyRate * 100).toFixed(2)}%).
            {Math.abs(previewRate - memberCollectLevyRate) > 1e-6 ? (
              <>
                {" "}
                Draft in field:{" "}
                <span className="font-mono font-semibold text-[var(--psc-ink)]">{previewRate}</span> (
                {(previewRate * 100).toFixed(2)}%) — totals below update to match the field.
              </>
            ) : null}
          </p>
        ) : null}

        {levyAnalytics ? (
          <div className="space-y-4 border-t border-[var(--psc-border)] pt-4">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Member levy flows</h4>
              {levyAnalytics.memberFlows.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--psc-border)] text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
                        <th className="py-2 pr-3">Member</th>
                        <th className="py-2 text-right">Paid via party tax</th>
                        <th className="py-2 text-right">Projected contribution</th>
                        <th className="py-2 text-right">Sent to member</th>
                        <th className="py-2 text-right">Donated to party</th>
                      </tr>
                    </thead>
                    <tbody>
                      {levyAnalytics.memberFlows.map((row) => {
                        const base = memberSalaryBase(row, memberCollectLevyRate);
                        const rowPreview = Math.round(base * displayRate * 100) / 100;
                        return (
                          <tr key={row.user_id} className="border-b border-[var(--psc-border)]/60">
                            <td className="py-2 pr-3 font-medium text-[var(--psc-ink)]">
                              {row.character_name?.trim() || row.user_id.slice(0, 8)}
                            </td>
                            <td className="py-2 text-right font-mono tabular-nums text-[var(--psc-ink)]">
                              {fmtUsd0(Number(row.withheld_total ?? 0))}
                            </td>
                            <td className="py-2 text-right font-mono tabular-nums text-[var(--psc-ink)]">
                              {fmtUsd0(rowPreview)}
                            </td>
                            <td className="py-2 text-right font-mono tabular-nums text-[var(--psc-ink)]">
                              {fmtUsd0(Number(row.received_total ?? 0))}
                            </td>
                            <td className="py-2 text-right font-mono tabular-nums text-[var(--psc-ink)]">
                              {fmtUsd0(Number(row.donated_total ?? 0))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-sm text-[var(--psc-muted)]">
                  No member levy/treasury flow rows yet.
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--psc-muted)]">
            Levy aggregates could not be loaded (try refreshing).
            {isChair ? " Saving the rate still applies once the server accepts it." : ""}
          </p>
        )}
      </section>
    </div>
  );
}
