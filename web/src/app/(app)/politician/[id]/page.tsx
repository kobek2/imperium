import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProfileImageWithFallback } from "@/components/profile-image-with-fallback";
import { profileImageSrc } from "@/components/profile-card";
import { simRegionByCode } from "@/lib/regions";
import { loadSimPoliticianById } from "@/lib/sim-politicians";
import { getServerAuth } from "@/lib/supabase/server";

function partyMeta(party: string | null | undefined) {
  switch (party) {
    case "democrat":
      return { label: "Democratic", pill: "bg-blue-600 text-white border-blue-700", accent: "border-blue-400" };
    case "republican":
      return { label: "Republican", pill: "bg-red-600 text-white border-red-700", accent: "border-red-400" };
    default:
      return { label: "Unaffiliated", pill: "bg-slate-200 text-slate-900 border-slate-300", accent: "border-[var(--psc-border)]" };
  }
}

function officeTitle(politician: {
  office: string;
  district_code: string | null;
  state_code: string | null;
  senate_class: number | null;
  ward_code?: string | null;
}) {
  if (politician.office === "council" && politician.ward_code) {
    return `Council Member, ${politician.ward_code}`;
  }
  if (politician.office === "mayor") {
    return "Mayor of New York City";
  }
  if (politician.office === "house" && politician.district_code) {
    return `Representative, ${politician.district_code} (archived)`;
  }
  if (politician.office === "senate" && politician.state_code) {
    const region = simRegionByCode(politician.state_code)?.name ?? politician.state_code;
    const cls = politician.senate_class != null ? ` (Class ${politician.senate_class})` : "";
    return `Senator, ${region}${cls} (archived)`;
  }
  return "City official";
}

export default async function SimPoliticianProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, user } = await getServerAuth();
  if (!supabase) redirect("/");
  if (!user) redirect("/login");

  const politician = await loadSimPoliticianById(supabase, id);
  if (!politician) notFound();

  const meta = partyMeta(politician.party);
  const photo = profileImageSrc(politician.face_claim_url);
  const name = politician.character_name.trim() || "Unnamed";
  const title = officeTitle(politician);

  return (
    <div className="space-y-6">
      <Link href="/directory" className="text-sm font-semibold text-[var(--psc-accent)]">
        ← Directory
      </Link>

      <article
        className={`grid grid-cols-1 gap-6 rounded-lg border-2 bg-[var(--psc-panel)] p-6 shadow-sm md:grid-cols-[minmax(220px,320px)_1fr] md:gap-10 md:p-10 ${meta.accent}`}
      >
        <div className="aspect-[3/4] w-full overflow-hidden rounded bg-[var(--psc-canvas)]">
          <ProfileImageWithFallback
            src={photo}
            name={name}
            variant="portrait"
            initialClassName="flex h-full w-full items-center justify-center text-6xl font-semibold tracking-wide text-[var(--psc-muted)]"
          />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-3 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${meta.pill}`}
            >
              {meta.label}
            </span>
            <span className="rounded-full border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
              Roster member
            </span>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">Current position</p>
            <p className="text-xl font-semibold tracking-tight text-[var(--psc-ink)] md:text-2xl">{title}</p>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-[var(--psc-ink)] md:text-5xl">{name}</h1>
          {politician.bio?.trim() ? (
            <div className="prose prose-sm max-w-none text-[var(--psc-ink)]">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{politician.bio.trim()}</p>
            </div>
          ) : null}
        </div>
      </article>
    </div>
  );
}
