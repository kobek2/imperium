"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Live countdown for floor voting; refreshes the page when the deadline passes so the pipeline can close the vote. */
export function BillVoteCountdown({ endsAtIso }: { endsAtIso: string }) {
  const router = useRouter();
  const end = new Date(endsAtIso).getTime();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    queueMicrotask(() => setNow(Date.now()));
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (now == null) return;
    if (end - now > 0) return;
    const t = window.setTimeout(() => router.refresh(), 800);
    return () => window.clearTimeout(t);
  }, [end, now, router]);

  if (now == null) {
    return (
      <p className="mt-2 font-mono text-sm font-semibold tabular-nums text-green-900">
        Voting closes in --:--
      </p>
    );
  }

  const left = end - now;
  return (
    <p className="mt-2 font-mono text-sm font-semibold tabular-nums text-green-900">
      Voting closes in {formatRemaining(left)}
    </p>
  );
}
