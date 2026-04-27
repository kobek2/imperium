import Link from "next/link";
import { redirect } from "next/navigation";
import { cabinetPortalCards, canAccessCabinetHub } from "@/lib/cabinet-hub";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";

const cardBtnClass =
  "mt-4 inline-flex w-full items-center justify-center rounded-md border-2 border-[var(--psc-accent)] bg-[color-mix(in_srgb,var(--psc-accent)_12%,white)] px-3 py-2 text-center text-sm font-bold text-[var(--psc-ink)] no-underline transition hover:bg-[color-mix(in_srgb,var(--psc-accent)_20%,white)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--psc-accent)]";

export default async function CabinetOverviewPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canAccessCabinetHub(roleKeys)) redirect("/");

  const cards = cabinetPortalCards();

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Cabinet</p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Department overview</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--psc-muted)]">
          Step into each cabinet portfolio. Treasury is live today; other departments will gain their own workspaces as
          we ship them.
        </p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <li
            key={c.roleKey}
            className="flex flex-col rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm"
          >
            <h2 className="text-base font-semibold text-[var(--psc-ink)]">{c.label}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--psc-muted)]">{c.blurb}</p>
            {c.href ? (
              <Link href={c.href} className={cardBtnClass}>
                Open department →
              </Link>
            ) : (
              <p className="mt-4 rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                Coming soon
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
