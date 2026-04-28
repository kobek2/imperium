"use client";

import { useCallback, useState } from "react";

function initialsFromName(name: string) {
  const raw = (name ?? "").trim();
  if (!raw) return "?";
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

type ProfileImageBodyProps = {
  src: string;
  name: string;
  className?: string;
  initialClassName?: string;
};

/** Holds error state; remounted by parent when `src` changes so a new URL gets a fresh try. */
function ProfileImageBody({
  src,
  name,
  className = "h-full w-full object-cover",
  initialClassName = "flex h-full w-full items-center justify-center text-3xl font-semibold tracking-wide text-[var(--psc-muted)]",
}: ProfileImageBodyProps) {
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => {
    setFailed(true);
  }, []);

  if (failed) {
    return <div className={initialClassName}>{initialsFromName(name)}</div>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
      onError={onError}
    />
  );
}

type ProfileImageWithFallbackProps = {
  src: string | null;
  name: string;
  className?: string;
  initialClassName?: string;
};

/**
 * Remote face URLs may 404, 429, or block hotlinking. On failure we show initials instead of a
 * broken image icon. Prefer Supabase Storage URLs from the character upload flow.
 */
export function ProfileImageWithFallback({
  src,
  name,
  className,
  initialClassName,
}: ProfileImageWithFallbackProps) {
  const trimmed = (src ?? "").trim();
  if (!trimmed) {
    return (
      <div
        className={
          initialClassName ??
          "flex h-full w-full items-center justify-center text-3xl font-semibold tracking-wide text-[var(--psc-muted)]"
        }
      >
        {initialsFromName(name)}
      </div>
    );
  }

  return (
    <ProfileImageBody
      key={trimmed}
      src={trimmed}
      name={name}
      className={className}
      initialClassName={initialClassName}
    />
  );
}
