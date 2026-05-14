"use client";

import { useEffect, useMemo, useState } from "react";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Same string on server and browser (avoids hydration mismatch from default locale / TZ). */
function formatDeadlineUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

export function AppropriationsCountdownBar({
  deadlineAt,
  enrolled,
  economyFrozen,
  variant = "amber",
}: {
  deadlineAt: string | null;
  enrolled: boolean;
  economyFrozen: boolean;
  variant?: "amber" | "slate";
}) {
  /** `null` until after mount so SSR and the first client paint match (no wall-clock in first render). */
  const [tick, setTick] = useState<number | null>(null);

  useEffect(() => {
    if (!deadlineAt || enrolled) return;
    setTick(Date.now());
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [deadlineAt, enrolled]);

  const { label, tone } = useMemo(() => {
    if (enrolled) return { label: null as string | null, tone: "muted" as const };
    if (economyFrozen) {
      return {
        label: "Economy is frozen by staff. Wallet collects stay blocked until the freeze is cleared; time spent frozen is not paid out on the next collect.",
        tone: "frozen" as const,
      };
    }
    if (!deadlineAt) {
      return {
        label: "No budget transition countdown is running. Staff start the 24-hour window from Admin → Economy overview.",
        tone: "muted" as const,
      };
    }
    const end = new Date(deadlineAt).getTime();
    if (tick == null) {
      return {
        label: `Budget transition deadline: ${formatDeadlineUtc(deadlineAt)}.`,
        tone: "active" as const,
      };
    }
    const left = end - tick;
    if (left <= 0) {
      return {
        label: `Budget transition window ended (${formatDeadlineUtc(deadlineAt)}). Staff may freeze the economy until the next-year workbook is submitted.`,
        tone: "ended" as const,
      };
    }
    return {
      label: `Time remaining in budget transition window: ${formatRemaining(left)} (deadline ${formatDeadlineUtc(deadlineAt)})`,
      tone: "active" as const,
    };
  }, [deadlineAt, enrolled, economyFrozen, tick]);

  if (enrolled || !label) return null;

  const box =
    tone === "frozen" || tone === "ended"
      ? "border-rose-600 bg-rose-50 text-rose-950"
      : tone === "muted"
        ? variant === "slate"
          ? "border-slate-500/50 bg-slate-50 text-slate-900"
          : "border-amber-700/40 bg-amber-50 text-amber-950"
        : variant === "slate"
          ? "border-sky-600/50 bg-sky-50 text-sky-950"
          : "border-amber-600 bg-amber-50 text-amber-950";

  return (
    <div className={`rounded border p-3 text-sm ${box}`}>
      <p className="font-semibold">{tone === "active" ? "Budget transition countdown" : "Federal budget transition"}</p>
      <p className="mt-1 leading-relaxed">{label}</p>
    </div>
  );
}
