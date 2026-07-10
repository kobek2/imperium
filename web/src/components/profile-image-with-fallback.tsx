"use client";

import { useCallback, useState } from "react";

function initialsFromName(name: string) {
  const raw = (name ?? "")
    .trim()
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .trim();
  if (!raw) return "?";
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export type ProfileImageVariant = "default" | "portrait";

const IMAGE_CLASS: Record<ProfileImageVariant, string> = {
  default: "h-full w-full object-cover object-center",
  portrait: "h-full w-full object-cover object-top",
};

/** Fixed-aspect frame for headshots — pair with `ProfileImageWithFallback variant="portrait"`. */
export function portraitFrameClassName(
  aspect: "square" | "3/4" | "4/3" = "3/4",
  extra?: string,
): string {
  const aspectClass =
    aspect === "square" ? "aspect-square" : aspect === "4/3" ? "aspect-[4/3]" : "aspect-[3/4]";
  return ["w-full overflow-hidden bg-[var(--psc-canvas)]", aspectClass, extra].filter(Boolean).join(" ");
}

type ProfileImageBodyProps = {
  src: string;
  name: string;
  variant?: ProfileImageVariant;
  className?: string;
  initialClassName?: string;
};

/** Holds error state; remounted by parent when `src` changes so a new URL gets a fresh try. */
function ProfileImageBody({
  src,
  name,
  variant = "default",
  className,
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
      className={className ?? IMAGE_CLASS[variant]}
      onError={onError}
    />
  );
}

type ProfileImageWithFallbackProps = {
  src: string | null;
  name: string;
  /** `portrait` anchors faces at the top — use for NPC/directory headshots. */
  variant?: ProfileImageVariant;
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
  variant = "default",
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
      variant={variant}
      className={className}
      initialClassName={initialClassName}
    />
  );
}
