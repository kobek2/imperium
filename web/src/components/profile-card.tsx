import Link from "next/link";

export type ProfileCardData = {
  /** When set, callers can rely on `profilePath(profile)` to build a stable link. */
  id?: string | null;
  character_name: string | null;
  face_claim_url: string | null;
  party?: string | null;
  bio?: string | null;
  residence_state?: string | null;
  home_district_code?: string | null;
};

/** Stable URL for a user's public profile page. */
export function profilePath(id: string | null | undefined): string | null {
  const v = (id ?? "").trim();
  return v ? `/profile/${v}` : null;
}

export type PartyKey = "democrat" | "republican" | "independent";

function partyColor(party: string | null | undefined) {
  switch (party) {
    case "democrat":
      return {
        label: "Democratic",
        pill: "bg-blue-600 text-white border-blue-700",
        cardBg: "bg-blue-50",
        cardBorder: "border-blue-400",
      };
    case "republican":
      return {
        label: "Republican",
        pill: "bg-red-600 text-white border-red-700",
        cardBg: "bg-red-50",
        cardBorder: "border-red-400",
      };
    case "independent":
      return {
        label: "Independent",
        pill: "bg-slate-700 text-white border-slate-800",
        cardBg: "bg-slate-50",
        cardBorder: "border-slate-400",
      };
    default:
      return {
        label: "Unaffiliated",
        pill: "bg-slate-200 text-slate-900 border-slate-300",
        cardBg: "bg-[var(--psc-panel)]",
        cardBorder: "border-[var(--psc-border)]",
      };
  }
}

function initials(name: string | null | undefined) {
  const raw = (name ?? "").trim();
  if (!raw) return "?";
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function validUrl(url: string | null | undefined) {
  const u = (url ?? "").trim();
  return u.startsWith("http://") || u.startsWith("https://") ? u : null;
}

function truncate(str: string | null | undefined, max: number) {
  const s = (str ?? "").trim();
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function seatLabel(profile: ProfileCardData) {
  const dist = (profile.home_district_code ?? "").trim();
  if (dist) return dist;
  const st = (profile.residence_state ?? "").trim().toUpperCase();
  return st || null;
}

/**
 * Square / rectangular profile tile with a photo on top, name, and short bio below.
 * Used by the directory, election candidate lists, and anywhere we render a person.
 *
 * Keep this purely presentational — voting UI, admin badges, or vote-share displays
 * should be composed by the caller via the `footer` slot.
 */
export function ProfileCard({
  profile,
  subtitle,
  footer,
  badges,
  emphasizeParty = false,
  href,
  selected = false,
  winner = false,
}: {
  profile: ProfileCardData;
  /** Optional line under the name (e.g. role label or seat). Overrides the auto seat line. */
  subtitle?: React.ReactNode;
  /** Slot below the bio (vote buttons, share %, etc.). */
  footer?: React.ReactNode;
  /** Small pills shown on top of the photo (e.g. "You", "Winner", "Leading"). */
  badges?: React.ReactNode;
  /** When true, tint the card with the candidate's party colors. */
  emphasizeParty?: boolean;
  /** If provided, the card becomes a link. */
  href?: string;
  selected?: boolean;
  winner?: boolean;
}) {
  const meta = partyColor(profile.party ?? null);
  const photo = validUrl(profile.face_claim_url);
  const name = profile.character_name?.trim() || "Unnamed";
  const bio = truncate(profile.bio, 140);
  const resolvedSubtitle = subtitle ?? seatLabel(profile);

  const baseBg = emphasizeParty ? meta.cardBg : "bg-[var(--psc-panel)]";
  const baseBorder = emphasizeParty ? meta.cardBorder : "border-[var(--psc-border)]";

  const outerClass = `flex h-full flex-col overflow-hidden rounded-lg border shadow-sm transition hover:shadow-md ${baseBg} ${
    winner
      ? "border-emerald-700 ring-2 ring-emerald-200"
      : selected
        ? "border-[var(--psc-accent)] ring-2 ring-[var(--psc-accent)]/30"
        : baseBorder
  }`;

  // We deliberately keep the footer OUTSIDE the link wrapper. Nesting a <form>/<button>
  // inside an <a> is invalid HTML — and for election cards it meant clicking the vote
  // button would navigate to the profile instead of submitting the vote.
  const headerInner = (
    <>
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--psc-canvas)]">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl font-semibold tracking-wide text-[var(--psc-muted)]">
            {initials(name)}
          </div>
        )}
        {badges ? (
          <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap gap-1">
            {badges}
          </div>
        ) : null}
        {profile.party ? (
          <span
            className={`absolute bottom-2 left-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.pill}`}
          >
            {meta.label}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div>
          <p className="truncate text-base font-semibold text-[var(--psc-ink)]">{name}</p>
          {resolvedSubtitle ? (
            <p className="mt-0.5 truncate text-xs text-[var(--psc-muted)]">{resolvedSubtitle}</p>
          ) : null}
        </div>
        {bio ? (
          <p className="line-clamp-3 text-xs leading-relaxed text-[var(--psc-muted)]">
            {bio}
          </p>
        ) : null}
      </div>
    </>
  );

  const header = href ? (
    <Link
      href={href}
      className="flex flex-1 flex-col outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--psc-accent)]"
    >
      {headerInner}
    </Link>
  ) : (
    <div className="flex flex-1 flex-col">{headerInner}</div>
  );

  return (
    <article className={outerClass}>
      {header}
      {footer ? <div className="px-4 pb-4">{footer}</div> : null}
    </article>
  );
}

export function ProfileCardBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "you" | "winner" | "leading" | "nominee";
}) {
  const toneClass =
    tone === "you"
      ? "bg-[var(--psc-ink)] text-white"
      : tone === "winner"
        ? "bg-emerald-600 text-white"
        : tone === "leading"
          ? "bg-violet-600 text-white"
          : tone === "nominee"
            ? "bg-amber-500 text-amber-950"
            : "bg-white/90 text-[var(--psc-ink)] border border-[var(--psc-border)]";
  return (
    <span
      className={`pointer-events-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shadow-sm ${toneClass}`}
    >
      {children}
    </span>
  );
}
