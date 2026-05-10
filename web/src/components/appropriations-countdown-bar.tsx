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
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineAt || enrolled) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [deadlineAt, enrolled]);

  const { label, tone } = useMemo(() => {
    if (enrolled) return { label: null as string | null, tone: "muted" as const };
    if (economyFrozen) {
      return {
        label: "Economy is frozen by staff until appropriations pass or the freeze is cleared.",
        tone: "frozen" as const,
      };
    }
    if (!deadlineAt) {
      return {
        label: "No appropriations countdown is running. Staff start the window from Admin → Economy overview.",
        tone: "muted" as const,
      };
    }
    const end = new Date(deadlineAt).getTime();
    const left = end - now;
    if (left <= 0) {
      return {
        label: `Appropriations window ended at ${new Date(deadlineAt).toLocaleString()}. Staff may freeze the economy until a budget is law.`,
        tone: "ended" as const,
      };
    }
    return {
      label: `Time remaining to enroll appropriations: ${formatRemaining(left)} (deadline ${new Date(deadlineAt).toLocaleString()})`,
      tone: "active" as const,
    };
  }, [deadlineAt, enrolled, economyFrozen, now]);

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
      <p className="font-semibold">{tone === "active" ? "Appropriations countdown" : "Federal budget / appropriations"}</p>
      <p className="mt-1 leading-relaxed">{label}</p>
    </div>
  );
}
