"use client";

import { useRouter } from "next/navigation";

/** Shared chrome for route buttons (replaces text links in headers). */
export const navRouteButtonClass =
  "inline-flex items-center justify-center rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-2 text-sm font-semibold text-[var(--psc-ink)] shadow-sm transition hover:bg-[color-mix(in_srgb,var(--psc-ink)_6%,var(--psc-panel))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--psc-accent)] active:translate-y-px";

export function NavRouteButton({
  href,
  children,
  className = "",
  disabled,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={disabled}
      className={`${navRouteButtonClass} disabled:pointer-events-none disabled:opacity-45 ${className}`.trim()}
      onClick={() => {
        if (!disabled) void router.push(href);
      }}
    >
      {children}
    </button>
  );
}
