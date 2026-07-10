"use client";

import { ProfileImageWithFallback } from "@/components/profile-image-with-fallback";
import type { OrdinanceRollCallRow } from "@/lib/city-office-data";

function voteBadge(vote: OrdinanceRollCallRow["vote"]) {
  if (vote === "yea") {
    return (
      <span className="rounded border border-green-700 bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase text-green-800">
        Yea
      </span>
    );
  }
  if (vote === "nay") {
    return (
      <span className="rounded border border-red-800 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-800">
        Nay
      </span>
    );
  }
  return (
    <span className="rounded border border-amber-500 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
      Pending
    </span>
  );
}

export function ordinanceStatusLabel(status: string): string {
  switch (status) {
    case "council_vote":
      return "Council vote open";
    case "awaiting_mayor":
      return "Awaiting mayor signature";
    case "enacted":
      return "Enacted";
    case "rejected":
      return "Rejected by council";
    case "vetoed":
      return "Vetoed by mayor";
    case "expired":
      return "Expired (superseded)";
    default:
      return status.replace(/_/g, " ");
  }
}

export function OrdinanceRollCallTable({ rows }: { rows: OrdinanceRollCallRow[] }) {
  if (rows.length === 0) return null;

  const yeas = rows.filter((r) => r.vote === "yea").length;
  const nays = rows.filter((r) => r.vote === "nay").length;
  const pending = rows.filter((r) => r.vote === "pending").length;

  return (
    <div className="mt-3 overflow-x-auto">
      <p className="mb-2 text-xs tabular-nums text-[var(--psc-muted)]">
        {yeas} Yea · {nays} Nay
        {pending > 0 ? ` · ${pending} pending` : ""}
      </p>
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--psc-border)] text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
            <th className="py-1.5 pr-2">Member</th>
            <th className="py-1.5 pr-2">Ward</th>
            <th className="py-1.5">Vote</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.wardCode} className="border-b border-[var(--psc-border)]/40">
              <td className="py-2 pr-2">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-[var(--psc-canvas)]">
                    <ProfileImageWithFallback
                      src={row.faceClaimUrl}
                      name={row.voterLabel}
                      variant="portrait"
                      initialClassName="flex h-full w-full items-center justify-center text-[10px] font-semibold text-[var(--psc-muted)]"
                    />
                  </div>
                  <span className="font-medium text-[var(--psc-ink)]">{row.voterLabel}</span>
                </div>
              </td>
              <td className="py-2 pr-2 font-mono text-xs text-[var(--psc-muted)]">{row.wardCode}</td>
              <td className="py-2">{voteBadge(row.vote)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
