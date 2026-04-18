"use client";

import { useFormStatus } from "react-dom";

/**
 * Form-aware submit button that disables itself the instant the parent form is submitted and
 * stays disabled until React has re-rendered with the new server state. This prevents users
 * from spam-clicking (e.g. "Vote" → "Unvote" → "Vote" in rapid succession) while the server
 * action + revalidatePath cycle is still in flight, which would otherwise fire N duplicate
 * actions against the DB.
 *
 * `useFormStatus` returns `pending: true` for the full window of:
 *   1. server action running,
 *   2. `revalidatePath` re-fetching, and
 *   3. React committing the new props,
 * so the user can only click again once the actual value has changed.
 */
export function SubmitButton({
  children,
  pendingLabel,
  disabled,
  className,
  variant = "primary",
  title,
  name,
  value,
}: {
  children: React.ReactNode;
  /** Label shown while the action is pending. Defaults to "Working…". */
  pendingLabel?: React.ReactNode;
  /** External disable (e.g. "you're not eligible"). Combined with pending via OR. */
  disabled?: boolean;
  className?: string;
  variant?: "primary" | "ghost" | "selected";
  title?: string;
  /** Passed through for multi-button forms where each button submits a different value. */
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const isDisabled = Boolean(disabled) || pending;

  // If a className is supplied we use it verbatim so callers have full control; otherwise we
  // fall back to three built-in looks that match the rest of the app.
  const baseClass =
    className ??
    (variant === "selected"
      ? "w-full rounded border border-[var(--psc-accent)] bg-[var(--psc-accent)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
      : variant === "ghost"
        ? "w-full rounded border border-[var(--psc-ink)] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)] transition hover:bg-[var(--psc-canvas)]"
        : "w-full rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white transition hover:brightness-110");

  const disabledClass = isDisabled
    ? "cursor-not-allowed opacity-50 hover:brightness-100"
    : "";

  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={isDisabled}
      title={title}
      aria-busy={pending || undefined}
      className={`${baseClass} ${disabledClass}`}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
