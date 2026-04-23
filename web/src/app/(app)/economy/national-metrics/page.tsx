"use client";

import { useEffect } from "react";

/** Old URL under Economy; national metrics now have a dedicated page. */
export default function NationalMetricsRedirectPage() {
  useEffect(() => {
    window.location.replace("/national-metrics");
  }, []);
  return (
    <p className="text-sm text-[var(--psc-muted)]" role="status">
      Opening national metrics…
    </p>
  );
}
