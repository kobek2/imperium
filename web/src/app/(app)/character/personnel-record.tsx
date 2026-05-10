import { ProfileImageWithFallback } from "@/components/profile-image-with-fallback";
import { formatDistrictLean } from "@/lib/district-lean";
import { displayFormerPositionsRp } from "@/lib/rp-former-positions";

export type PersonnelProfile = {
  character_name: string | null;
  date_of_birth: string | null;
  residence_state: string | null;
  home_district_code: string | null;
  party: string | null;
  bio: string | null;
  face_claim_url: string | null;
  former_positions: string | null;
  discord_username: string | null;
};

function partyShort(party: string | null) {
  if (party === "democrat") return "Democratic";
  if (party === "republican") return "Republican";
  return "Independent";
}

function displayName(name: string | null) {
  const t = (name ?? "").trim();
  return t.length ? t : "Unnamed";
}

export function PersonnelRecord({
  profile,
  primaryTitle,
  districtPvi,
}: {
  profile: PersonnelProfile;
  primaryTitle: string;
  districtPvi: number | null;
}) {
  const name = displayName(profile.character_name);
  const districtLine = profile.home_district_code
    ? districtPvi !== null
      ? `${profile.home_district_code} (${formatDistrictLean(districtPvi)})`
      : profile.home_district_code
    : null;
  return (
    <section
      className="mb-10 border-2 border-[var(--psc-ink)] bg-[var(--psc-panel)] p-8 pr-24 shadow-sm"
      aria-labelledby="personnel-record-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--psc-border)] pb-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--psc-muted)]">
            Federal personnel record
          </p>
          <h1
            id="personnel-record-heading"
            className="mt-1 text-2xl font-semibold tracking-tight text-[var(--psc-ink)]"
          >
            {name}
          </h1>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Party: <span className="font-semibold text-[var(--psc-ink)]">{partyShort(profile.party)}</span>
          </p>
        </div>
        <div className="h-24 w-24 shrink-0 overflow-hidden border border-[var(--psc-border)] bg-[var(--psc-canvas)]">
          <ProfileImageWithFallback
            src={profile.face_claim_url}
            name={name}
            className="h-full w-full object-cover"
            initialClassName="flex h-24 w-24 items-center justify-center text-2xl font-semibold text-[var(--psc-muted)]"
          />
        </div>
      </div>

      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Current office
          </dt>
          <dd className="mt-1 text-[var(--psc-ink)]">{primaryTitle}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Date of birth
          </dt>
          <dd className="mt-1 font-mono text-[var(--psc-ink)]">
            {profile.date_of_birth
              ? new Date(profile.date_of_birth + "T12:00:00").toLocaleDateString()
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Discord
          </dt>
          <dd className="mt-1 break-all text-[var(--psc-ink)]">
            {profile.discord_username ? (
              <>@{profile.discord_username}</>
            ) : (
              <span className="text-[var(--psc-muted)]">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Home congressional district
          </dt>
          <dd className="mt-1 font-mono text-[var(--psc-ink)]">
            {districtLine ?? <span className="text-[var(--psc-muted)]">—</span>}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Biography
          </dt>
          <dd className="mt-1 whitespace-pre-wrap text-[var(--psc-ink)]">
            {profile.bio?.trim() ? profile.bio : "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Former positions (RP)
          </dt>
          <dd className="mt-1 whitespace-pre-wrap text-[var(--psc-ink)]">
            {displayFormerPositionsRp(profile.former_positions) || "—"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
