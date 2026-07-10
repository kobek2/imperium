"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ProfileImageWithFallback } from "@/components/profile-image-with-fallback";
import { ProfileCard, profileImageSrc, profilePath } from "@/components/profile-card";
import type { DirectoryHolder } from "@/lib/directory-types";

export type { DirectoryHolder };

type RoleRow = {
  role_key: string;
  role_label: string;
  holders: DirectoryHolder[];
};

export type LawEntry = {
  id: string;
  title: string;
  signed_at: string | null;
  created_at: string;
  source: "bill" | "ordinance";
  /** Legacy federal-style bills routed through the bills table. */
  originating_chamber?: "house" | "senate";
  author_id?: string;
  author_name?: string | null;
  author_party?: string | null;
  house_yea?: number;
  house_nay?: number;
  senate_yea?: number;
  senate_nay?: number;
  /** City ordinance proposals signed by the mayor. */
  category?: string;
  stance_label?: string;
  council_yea?: number;
  council_nay?: number;
  sponsor_name?: string | null;
};

export type DirectoryTab = {
  id: string;
  label: string;
  heroTitle: string;
  heroKicker?: string;
  sections: Array<
    | { kind: "featured"; roles: RoleRow[] }
    | { kind: "grid"; title: string; roles: RoleRow[]; maxSlots?: number }
    | { kind: "enacted_laws"; title: string; laws: LawEntry[] }
  >;
};

function partyLabel(party: string | null | undefined) {
  if (party === "democrat") return { text: "Democratic Party", color: "text-blue-700" };
  if (party === "republican") return { text: "Republican Party", color: "text-red-700" };
  if (party === "independent") return { text: "Independent", color: "text-slate-700" };
  return null;
}

function seatLabel(h: DirectoryHolder) {
  const dist = (h.home_district_code ?? "").trim();
  if (dist) return dist;
  const st = (h.residence_state ?? "").trim().toUpperCase();
  return st || null;
}

/**
 * The hero banner at the top of each tab — dark navy gradient styled as a city hall masthead.
 */
function DirectoryHero({ title, kicker }: { title: string; kicker?: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-[var(--psc-border)] bg-gradient-to-br from-[#0a1f3d] via-[#11326b] to-[#1f4d8f]">
      <div className="absolute inset-0 opacity-[0.08] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:18px_18px]" />
      <div className="relative flex flex-col items-center justify-center gap-2 px-8 py-14 text-center md:py-20">
        {kicker ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-sky-200/80">
            {kicker}
          </p>
        ) : null}
        <h2 className="text-4xl font-bold tracking-tight text-white drop-shadow-sm md:text-5xl">
          {title}
        </h2>
      </div>
    </div>
  );
}

/**
 * Big horizontal "leader" card — large portrait on the left, role title and bio on the right.
 * Used for the headline holder(s) of a branch (e.g. Mayor, Council Spokesperson).
 */
function FeaturedHolder({
  holder,
  roleLabel,
}: {
  holder: DirectoryHolder;
  roleLabel: string;
}) {
  const isPlaceholder = holder.isPlaceholder === true || holder.id.startsWith("placeholder:");
  const photo = profileImageSrc(holder.face_claim_url);
  const name = holder.character_name?.trim() || holder.discord_username?.trim() || "Unnamed";
  const party = partyLabel(holder.party);
  const seat = seatLabel(holder);
  const bio = (holder.bio ?? "").trim();

  const accent =
    holder.party === "democrat"
      ? "border-blue-400"
      : holder.party === "republican"
        ? "border-red-400"
        : "border-[var(--psc-border)]";

  const href = profilePath(holder.id);

  return (
    <article
      className={`grid grid-cols-1 gap-6 rounded-lg border-2 bg-[var(--psc-panel)] p-6 shadow-sm md:grid-cols-[minmax(200px,280px)_1fr] md:gap-8 md:p-8 ${accent}`}
    >
      {href ? (
        <Link
          href={href}
          className="aspect-[3/4] w-full overflow-hidden rounded bg-[var(--psc-canvas)] outline-none transition hover:opacity-95 focus-visible:ring-2 focus-visible:ring-[var(--psc-accent)]"
        >
          <ProfileImageWithFallback
            src={photo}
            name={name}
            variant="portrait"
            initialClassName="flex h-full w-full items-center justify-center text-5xl font-semibold tracking-wide text-[var(--psc-muted)]"
          />
        </Link>
      ) : (
        <div className="aspect-[3/4] w-full overflow-hidden rounded bg-[var(--psc-canvas)]">
          <ProfileImageWithFallback
            src={photo}
            name={name}
            variant="portrait"
            initialClassName="flex h-full w-full items-center justify-center text-5xl font-semibold tracking-wide text-[var(--psc-muted)]"
          />
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">
            {roleLabel}
          </p>
          {isPlaceholder ? (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
              Default roster
            </span>
          ) : null}
        </div>
        {href ? (
          <Link href={href} className="group inline-flex w-fit">
            <h3 className="text-3xl font-bold tracking-tight text-[var(--psc-accent)] transition group-hover:underline md:text-4xl">
              {name}
            </h3>
          </Link>
        ) : (
          <h3 className="text-3xl font-bold tracking-tight text-[var(--psc-accent)] md:text-4xl">
            {name}
          </h3>
        )}
        <div className="flex flex-wrap gap-2 text-sm text-[var(--psc-muted)]">
          {party ? <span className={`font-semibold ${party.color}`}>{party.text}</span> : null}
          {party && seat ? <span>·</span> : null}
          {seat ? <span className="font-mono">{seat}</span> : null}
        </div>
        {bio ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--psc-ink)]">
            {bio}
          </p>
        ) : (
          <p className="text-sm italic text-[var(--psc-muted)]">
            No biography on file.
          </p>
        )}
      </div>
    </article>
  );
}

function FeaturedVacant({ roleLabel }: { roleLabel: string }) {
  return (
    <article className="grid grid-cols-1 gap-6 rounded-lg border-2 border-dashed border-[var(--psc-border)] bg-[var(--psc-panel)]/60 p-6 md:grid-cols-[minmax(200px,280px)_1fr] md:p-8">
      <div className="flex aspect-[3/4] w-full items-center justify-center rounded bg-[var(--psc-canvas)] text-sm text-[var(--psc-muted)]">
        Vacant
      </div>
      <div className="flex flex-col justify-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">
          {roleLabel}
        </p>
        <h3 className="text-3xl font-bold tracking-tight text-[var(--psc-muted)] md:text-4xl">
          Vacant
        </h3>
        <p className="text-sm text-[var(--psc-muted)]">
          No one currently holds this position.
        </p>
      </div>
    </article>
  );
}

export function HierarchyTabs({ tabs }: { tabs: DirectoryTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const current = useMemo(() => tabs.find((t) => t.id === active) ?? tabs[0], [active, tabs]);

  if (!current) {
    return (
      <p className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 text-sm text-[var(--psc-muted)]">
        No directory data configured.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={
              t.id === current.id
                ? "rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white"
                : "rounded border border-[var(--psc-border)] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)] transition hover:border-[var(--psc-accent)]"
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      <DirectoryHero title={current.heroTitle} kicker={current.heroKicker} />

      <div className="space-y-10">
        {current.sections.map((section, idx) => {
          if (section.kind === "enacted_laws") {
            return (
              <EnactedLawsSection
                key={`${current.id}-laws-${idx}`}
                title={section.title}
                laws={section.laws}
              />
            );
          }
          if (section.kind === "featured") {
            return (
              <section key={`${current.id}-featured-${idx}`} className="space-y-4">
                {section.roles.map((role) =>
                  role.holders.length ? (
                    role.holders.map((h) => (
                      <FeaturedHolder
                        key={`${role.role_key}-${h.id}`}
                        holder={h}
                        roleLabel={role.role_label}
                      />
                    ))
                  ) : (
                    <FeaturedVacant key={`${role.role_key}-vacant`} roleLabel={role.role_label} />
                  ),
                )}
              </section>
            );
          }

          // Fixed slot count (e.g. eight Associate Justice seats): always show N profile tiles,
          // filling with holders in sort order and vacant placeholders for open seats.
          if (section.maxSlots != null && section.maxSlots > 0) {
            const primary = section.roles[0];
            if (!primary) return null;
            const holders = primary.holders;
            const tiles: Array<{ holder: DirectoryHolder | null }> = [];
            for (let i = 0; i < section.maxSlots; i++) {
              tiles.push({ holder: holders[i] ?? null });
            }

            return (
              <section key={`${current.id}-grid-${idx}`} className="space-y-4">
                <h3 className="border-b border-[var(--psc-border)] pb-2 text-lg font-semibold text-[var(--psc-ink)]">
                  {section.title}
                </h3>
                <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  {tiles.map(({ holder }, tileIdx) => (
                    <li key={`${primary.role_key}-slot-${tileIdx}`}>
                      {holder ? (
                        <ProfileCard
                          profile={{
                            id: holder.id,
                            character_name:
                              holder.character_name ?? holder.discord_username ?? "Unnamed",
                            face_claim_url: holder.face_claim_url,
                            party: holder.party,
                            bio: holder.bio,
                            residence_state: holder.residence_state,
                            home_district_code: holder.home_district_code,
                          }}
                          subtitle={primary.role_label}
                          href={profilePath(holder.id) ?? undefined}
                          badges={
                            holder.isPlaceholder === true || holder.id.startsWith("placeholder:") ? (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-950">
                                Default
                              </span>
                            ) : undefined
                          }
                        />
                      ) : (
                        <VacantTile roleLabel={primary.role_label} />
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          }

          // Flatten the grid: each tile is a (role, holder) pair so that when multiple roles
          // share a section (e.g. "Leadership"), every position renders its own card.
          const tiles: Array<{ role: RoleRow; holder: DirectoryHolder | null }> = [];
          for (const role of section.roles) {
            if (role.holders.length) {
              for (const h of role.holders) tiles.push({ role, holder: h });
            } else {
              // Leadership roles: still show a vacant slot so people know the post exists.
              // Rank-and-file buckets (Members) with zero holders collapse quietly instead.
              const isRankAndFile = role.role_key === "council_member";
              if (!isRankAndFile) tiles.push({ role, holder: null });
            }
          }

          if (!tiles.length) return null;

          return (
            <section key={`${current.id}-grid-${idx}`} className="space-y-4">
              <h3 className="border-b border-[var(--psc-border)] pb-2 text-lg font-semibold text-[var(--psc-ink)]">
                {section.title}
              </h3>
              <ul className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
                {tiles.map(({ role, holder }, tileIdx) => (
                  <li key={`${role.role_key}-${holder?.id ?? "vacant"}-${tileIdx}`}>
                    {holder ? (
                      <ProfileCard
                        profile={{
                          id: holder.id,
                          character_name:
                            holder.character_name ?? holder.discord_username ?? "Unnamed",
                          face_claim_url: holder.face_claim_url,
                          party: holder.party,
                          bio: holder.bio,
                          residence_state: holder.residence_state,
                          home_district_code: holder.home_district_code,
                        }}
                        subtitle={role.role_label}
                        href={profilePath(holder.id) ?? undefined}
                        badges={
                          holder.isPlaceholder === true || holder.id.startsWith("placeholder:") ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-950">
                              Default
                            </span>
                          ) : undefined
                        }
                      />
                    ) : (
                      <VacantTile roleLabel={role.role_label} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function EnactedLawsSection({ title, laws }: { title: string; laws: LawEntry[] }) {
  if (!laws.length) {
    return (
      <section className="space-y-3">
        <h3 className="border-b border-[var(--psc-border)] pb-2 text-lg font-semibold text-[var(--psc-ink)]">
          {title}
        </h3>
        <p className="rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-panel)]/60 p-6 text-sm italic text-[var(--psc-muted)]">
          No local laws have been enacted yet.
        </p>
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <h3 className="border-b border-[var(--psc-border)] pb-2 text-lg font-semibold text-[var(--psc-ink)]">
        {title}{" "}
        <span className="ml-1 text-xs font-normal text-[var(--psc-muted)]">
          ({laws.length})
        </span>
      </h3>
      <ul className="divide-y divide-[var(--psc-border)] rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]">
        {laws.map((law) =>
          law.source === "ordinance" ? (
            <OrdinanceLawRow key={law.id} law={law} />
          ) : (
            <BillLawRow key={law.id} law={law} />
          ),
        )}
      </ul>
    </section>
  );
}

function BillLawRow({ law }: { law: LawEntry }) {
  const party = partyLabel(law.author_party);
  const authorHref = law.author_id ? profilePath(law.author_id) : null;
  const originatingLabel =
    law.originating_chamber === "house" ? "City Council" : "Mayor's office";
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--psc-ink)]">
          <Link href={`/bill/${law.id}`} className="hover:underline">
            {law.title}
          </Link>
        </p>
        <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
          Authored by{" "}
          {authorHref ? (
            <Link
              href={authorHref}
              className={`font-semibold hover:underline ${party ? party.color : "text-[var(--psc-ink)]"}`}
            >
              {law.author_name ?? "Unknown"}
            </Link>
          ) : (
            <span className="font-semibold text-[var(--psc-ink)]">
              {law.author_name ?? "Unknown"}
            </span>
          )}
          {" · "}
          Originated in the {originatingLabel}
        </p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
          Council {law.house_yea ?? 0}–{law.house_nay ?? 0} · Mayor {law.senate_yea ?? 0}–
          {law.senate_nay ?? 0}
        </p>
      </div>
      <div className="text-right">
        <p className="rounded-full border border-green-300 bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-900">
          Signed
        </p>
        {law.signed_at ? (
          <p className="mt-1 text-[10px] text-[var(--psc-muted)]">
            {new Date(law.signed_at).toLocaleDateString()}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function OrdinanceLawRow({ law }: { law: LawEntry }) {
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--psc-ink)]">{law.title}</p>
        <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
          {law.category ? <span className="font-semibold text-[var(--psc-ink)]">{law.category}</span> : null}
          {law.category && law.stance_label ? " · " : null}
          {law.stance_label ? <span>{law.stance_label}</span> : null}
          {law.sponsor_name ? (
            <>
              {" · "}
              Sponsored by <span className="font-semibold text-[var(--psc-ink)]">{law.sponsor_name}</span>
            </>
          ) : null}
        </p>
        {law.council_yea != null && law.council_nay != null ? (
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
            Council roll call {law.council_yea}–{law.council_nay}
          </p>
        ) : null}
      </div>
      <div className="text-right">
        <p className="rounded-full border border-green-300 bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-900">
          Enacted
        </p>
        {law.signed_at ? (
          <p className="mt-1 text-[10px] text-[var(--psc-muted)]">
            {new Date(law.signed_at).toLocaleDateString()}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function VacantTile({ roleLabel }: { roleLabel: string }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-dashed border-[var(--psc-border)] bg-[var(--psc-panel)]/50">
      <div className="flex aspect-[3/4] w-full items-center justify-center bg-[var(--psc-canvas)] text-xs uppercase tracking-wide text-[var(--psc-muted)]">
        Vacant
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="truncate text-sm font-semibold text-[var(--psc-muted)]">{roleLabel}</p>
        <p className="text-xs italic text-[var(--psc-muted)]">No one in this role yet.</p>
      </div>
    </div>
  );
}
