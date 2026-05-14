import type { ReactNode } from "react";

/** Lightweight “ops room” frame: grid + glow + toy radar (decorative). */
export function DefenseCommandCenterShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-900/25 bg-[var(--psc-panel)] shadow-lg ring-1 ring-emerald-800/15">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(16,185,129,0.45)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.45)_1px,transparent_1px)] [background-size:28px_28px]"
        aria-hidden
      />
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" aria-hidden />
      <div className="relative border-b border-emerald-900/20 bg-[color-mix(in_srgb,var(--psc-ink)_4%,transparent)] px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start gap-5">
          <div
            className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-2 border-emerald-600/40 bg-[color-mix(in_srgb,#022c22_12%,var(--psc-canvas))] shadow-[inset_0_0_24px_rgba(16,185,129,0.12)]"
            aria-hidden
          >
            <div
              className="absolute inset-2 rounded-full border border-emerald-400/25"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0deg 40deg, rgba(52,211,153,0.35) 40deg 70deg, transparent 70deg 360deg)",
              }}
            />
            <div className="absolute left-1/2 top-3 h-2 w-2 -translate-x-1/2 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.9)]" />
            <div className="absolute bottom-5 right-6 h-1.5 w-1.5 rounded-full bg-amber-300/90 shadow-[0_0_6px_rgba(252,211,77,0.7)]" />
            <div className="absolute left-5 top-12 h-1.5 w-1.5 rounded-full bg-sky-300/80" />
            <span className="relative font-mono text-[9px] font-bold uppercase tracking-[0.35em] text-emerald-700/90">
              scan
            </span>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.35em] text-emerald-800/80">
              Defense desk
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">{title}</h1>
            <p className="max-w-2xl text-sm leading-relaxed text-[var(--psc-muted)]">{subtitle}</p>
          </div>
        </div>
      </div>
      <div className="relative space-y-6 px-4 py-6 sm:px-6">{children}</div>
    </div>
  );
}
