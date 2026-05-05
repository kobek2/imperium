"use client";

import { useRouter } from "next/navigation";

const baseClass =
  "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--psc-border)] bg-[var(--psc-panel)]/95 px-3 py-2 text-xs font-semibold text-[var(--psc-ink)] shadow-sm transition hover:bg-[color-mix(in_srgb,var(--psc-canvas)_55%,var(--psc-panel))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--psc-accent)] active:translate-y-px";

/**
 * Uses the browser session history (same as the browser back control).
 */
export function HistoryBackButton({ className }: { className?: string }) {
  const router = useRouter();
  const merged = [baseClass, className].filter(Boolean).join(" ");

  return (
    <button type="button" onClick={() => router.back()} className={merged} aria-label="Back to previous page">
      <span aria-hidden className="text-[13px] leading-none opacity-80">
        ←
      </span>
      Back
    </button>
  );
}
