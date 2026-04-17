"use client";

import { useFormStatus } from "react-dom";

export function FormSubmitButton({
  idleLabel,
  pendingLabel,
  className,
  type = "submit",
}: {
  idleLabel: string;
  pendingLabel?: string;
  className: string;
  type?: "submit" | "button";
}) {
  const { pending } = useFormStatus();
  return (
    <button type={type} disabled={pending} className={`${className} disabled:cursor-not-allowed disabled:opacity-70`}>
      {pending ? (pendingLabel ?? "Saving...") : idleLabel}
    </button>
  );
}