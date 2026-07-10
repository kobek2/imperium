"use client";

import {
  approvalTier,
  approvalTone,
  type ApprovalTier,
} from "@/lib/city-metrics-presentation";

const TIER_LABELS: Record<ApprovalTier, string> = {
  strong: "Strong standing",
  stable: "Stable",
  shaky: "Shaky",
  critical: "Critical",
};

export function ApprovalRatingBar({
  rating,
  tier: tierProp,
  compact,
}: {
  rating: number;
  tier?: ApprovalTier;
  compact?: boolean;
}) {
  const tier = tierProp ?? approvalTier(rating);
  const tone = approvalTone(rating);
  const fillClass =
    tone === "good"
      ? "bg-green-600"
      : tone === "bad"
        ? "bg-red-600"
        : "bg-amber-500";
  const borderClass =
    tone === "good"
      ? "border-green-300/60 bg-green-50/40 dark:bg-green-950/20"
      : tone === "bad"
        ? "border-red-300/60 bg-red-50/40 dark:bg-red-950/20"
        : "border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20";

  return (
    <div className={`rounded border p-3 ${borderClass} ${compact ? "p-2.5" : ""}`}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Approval rating
          </p>
          <p className={`font-semibold tabular-nums text-[var(--psc-ink)] ${compact ? "text-2xl" : "text-3xl"}`}>
            {rating}
            <span className="text-base font-normal text-[var(--psc-muted)]"> / 100</span>
          </p>
        </div>
        <p className="text-xs font-medium text-[var(--psc-muted)]">{TIER_LABELS[tier]}</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--psc-border)]">
        <div
          className={`h-full rounded-full transition-all ${fillClass}`}
          style={{ width: `${Math.max(0, Math.min(100, rating))}%` }}
        />
      </div>
    </div>
  );
}
