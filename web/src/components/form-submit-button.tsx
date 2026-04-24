"use client";

import { useFormStatus } from "react-dom";

export function FormSubmitButton({
  idleLabel,
  pendingLabel,
  className,
  type = "submit",
  disabled,
}: {
  idleLabel: string;
  pendingLabel?: string;
  className: string;
  type?: "submit" | "button";
  /** Combined with `pending` via OR (e.g. form validation). */
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const isDisabled = Boolean(disabled) || pending;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={pending || undefined}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-70`}
    >
      {pending ? (pendingLabel ?? "Saving...") : idleLabel}
    </button>
  );
}