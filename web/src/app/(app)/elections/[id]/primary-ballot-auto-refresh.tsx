"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches the server page so vote tallies stay roughly live while the primary is open. */
export function PrimaryBallotAutoRefresh({ intervalMs = 12000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs]);
  return null;
}
