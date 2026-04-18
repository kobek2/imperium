import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";

function partyMeta(party: string | null | undefined) {
  switch (party) {
    case "democrat":
      return { label: "Democratic", pill: "bg-blue-600 text-white border-blue-700", accent: "border-blue-400" };
    case "republican":
      return { label: "Republican", pill: "bg-red-600 text-white border-red-700", accent: "border-red-400" };
    case "independent":
      return { label: "Independent", pill: "bg-slate-700 text-white border-slate-800", accent: "border-slate-400" };
    default:
      return { label: "Unaffiliated", pill: "bg-slate-200 text-slate-900 border-slate-300", accent: "border-[var(--psc-border)]" };
  }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function validUrl(url: string | null | undefined) {
  const u = (url ?? "").trim();
  return u.startsWith("http://") || u.startsWith("https://") ? u : null;
}

function roleLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return key
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function seatLine(profile: { home_district_code: string | null; residence_state: string | null }) {
  const d = (profile.home_district_code ?? "").trim();
  if (d) return `House district ${d}`;
  const s = (profile.residence_state ?? "").trim().toUpperCase();
  if (s) return `Residence ${s}`;
  return null;
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await tryCreateClient();
  if (!supabase) redirect("/");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Parallel fetch: the profile itself, role grants (with timestamps so we can render a
  // tidy role-history list below the banner), and any bills this user authored that made
  // it into law. Dead / vetoed / in-flight bills are intentionally excluded — the profile
  // only shows shipped legislation.
  const [{ data: profile }, { data: grantRows }, { data: lawBills }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, character_name, discord_username, party, bio, face_claim_url, residence_state, home_district_code, office_role, former_positions",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("government_role_grants")
      .select("role_key, granted_at")
      .eq("user_id", id)
      .order("granted_at", { ascending: false }),
    supabase
      .from("bills")
      .select("id, title, originating_chamber, created_at, signed_at")
      .eq("author_id", id)
      .eq("status", "law")
      .order("signed_at", { ascending: false, nullsFirst: false }),
  ]);

  if (!profile) notFound();

  const laws = (lawBills ?? []) as Array<{
    id: string;
    title: string;
    originating_chamber: "house" | "senate";
    created_at: string;
    signed_at: string | null;
  }>;

  // Vote tallies for the bills this user authored, so we can render the final House/
  // Senate margin on each card without a second round-trip per bill.
  const lawTallies = new Map<
    string,
    { house_yea: number; house_nay: number; senate_yea: number; senate_nay: number }
  >();
  if (laws.length) {
    const { data: lawVotes } = await supabase
      .from("bill_votes")
      .select("bill_id, chamber, vote")
      .in(
        "bill_id",
        laws.map((b) => b.id),
      )
      .in("vote", ["yea", "nay"]);
    for (const v of (lawVotes ?? []) as Array<{
      bill_id: string;
      chamber: "house" | "senate";
      vote: "yea" | "nay";
    }>) {
      const t = lawTallies.get(v.bill_id) ?? {
        house_yea: 0,
        house_nay: 0,
        senate_yea: 0,
        senate_nay: 0,
      };
      if (v.chamber === "house" && v.vote === "yea") t.house_yea++;
      else if (v.chamber === "house" && v.vote === "nay") t.house_nay++;
      else if (v.chamber === "senate" && v.vote === "yea") t.senate_yea++;
      else if (v.chamber === "senate" && v.vote === "nay") t.senate_nay++;
      lawTallies.set(v.bill_id, t);
    }
  }

  const meta = partyMeta(profile.party);
  const photo = validUrl(profile.face_claim_url);
  const name = profile.character_name?.trim() || profile.discord_username?.trim() || "Unnamed";
  const seat = seatLine(profile);

  const roleKeys = new Set<string>();
  for (const r of grantRows ?? []) {
    if (r.role_key) roleKeys.add(r.role_key);
  }
  if (profile.office_role) roleKeys.add(profile.office_role);
  // Surface the political offices someone holds, but hide the app-level "admin" grant and
  // the default "citizen" fallback since they'd be noise on a public profile.
  const filteredRoles = [...roleKeys].filter((k) => k !== "admin" && k !== "citizen");
  const offices = grantRows ?? [];

  const isSelf = user.id === id;

  return (
    <div className="space-y-6">
      <Link href="/directory" className="text-sm font-semibold text-[var(--psc-accent)]">
        ← Directory
      </Link>

      <article
        className={`grid grid-cols-1 gap-6 rounded-lg border-2 bg-[var(--psc-panel)] p-6 shadow-sm md:grid-cols-[minmax(220px,320px)_1fr] md:gap-10 md:p-10 ${meta.accent}`}
      >
        <div className="aspect-[3/4] w-full overflow-hidden rounded bg-[var(--psc-canvas)]">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-6xl font-semibold tracking-wide text-[var(--psc-muted)]">
              {initials(name)}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-3 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${meta.pill}`}
            >
              {meta.label}
            </span>
            {isSelf ? (
              <Link
                href="/character"
                className="rounded border border-[var(--psc-border)] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)] transition hover:bg-[var(--psc-canvas)]"
              >
                Edit character →
              </Link>
            ) : null}
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-[var(--psc-ink)] md:text-5xl">{name}</h1>
          {profile.discord_username ? (
            <p className="text-sm text-[var(--psc-muted)]">
              Discord: <span className="font-mono">{profile.discord_username}</span>
            </p>
          ) : null}
          {seat ? (
            <p className="text-sm font-semibold text-[var(--psc-ink)]">{seat}</p>
          ) : null}

          {filteredRoles.length ? (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">
                Current offices
              </p>
              <ul className="flex flex-wrap gap-2">
                {filteredRoles.map((key) => (
                  <li
                    key={key}
                    className="rounded border border-[var(--psc-border)] bg-white px-2 py-1 text-xs font-semibold text-[var(--psc-ink)]"
                  >
                    {roleLabel(key)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {profile.bio?.trim() ? (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">
                Biography
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--psc-ink)]">
                {profile.bio}
              </p>
            </div>
          ) : null}

          {profile.former_positions?.trim() ? (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">
                Former positions
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--psc-muted)]">
                {profile.former_positions}
              </p>
            </div>
          ) : null}
        </div>
      </article>

      {offices.length ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">
            Role history
          </h2>
          <ul className="divide-y divide-[var(--psc-border)] rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]">
            {offices.map((o, idx) => (
              <li
                key={`${o.role_key}-${o.granted_at}-${idx}`}
                className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3"
              >
                <span className="text-sm font-semibold text-[var(--psc-ink)]">{roleLabel(o.role_key)}</span>
                {o.granted_at ? (
                  <span className="text-xs text-[var(--psc-muted)]">
                    Granted {new Date(o.granted_at).toLocaleDateString()}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">
          Bills passed{" "}
          {laws.length ? (
            <span className="ml-1 text-[10px] font-normal normal-case tracking-normal text-[var(--psc-muted)]">
              ({laws.length})
            </span>
          ) : null}
        </h2>
        {laws.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-panel)]/60 p-4 text-sm italic text-[var(--psc-muted)]">
            No bills authored by this member have been signed into law yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--psc-border)] rounded border border-[var(--psc-border)] bg-[var(--psc-panel)]">
            {laws.map((b) => {
              const t = lawTallies.get(b.id);
              return (
                <li key={b.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--psc-ink)]">{b.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--psc-muted)]">
                      Originated in the {b.originating_chamber === "house" ? "House" : "Senate"}
                      {" · Filed "}
                      {new Date(b.created_at).toLocaleDateString()}
                    </p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-[var(--psc-muted)]">
                      House {t?.house_yea ?? 0}–{t?.house_nay ?? 0} · Senate {t?.senate_yea ?? 0}–
                      {t?.senate_nay ?? 0}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="rounded-full border border-green-300 bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-900">
                      Signed
                    </p>
                    {b.signed_at ? (
                      <p className="mt-1 text-[10px] text-[var(--psc-muted)]">
                        {new Date(b.signed_at).toLocaleDateString()}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
