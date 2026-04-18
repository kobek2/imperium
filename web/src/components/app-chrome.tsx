import Link from "next/link";
import { tryCreateClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/is-admin";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { canReviewAnyChamberLeadership } from "@/lib/role-capabilities";
import {
  computeSimulationRpInstant,
  formatRpCalendarShort,
  type SimulationSettingsRow,
} from "@/lib/simulation-calendar";
import { resolveSimulationSettingsForWidget } from "@/lib/simulation-widget-data";
import { SignOut } from "@/components/sign-out";

const links = [
  { href: "/", label: "Briefing" },
  { href: "/character", label: "Character" },
  { href: "/elections", label: "Elections" },
  { href: "/congress", label: "Congress" },
  { href: "/oval", label: "Oval Office" },
  { href: "/directory", label: "Directory" },
];

export async function AppChrome({ children }: { children: React.ReactNode }) {
  const supabase = await tryCreateClient();
  const user = supabase
    ? (await supabase.auth.getUser()).data.user
    : null;

  // Admin check and the role-lookup chain that gates the Leadership link are both per-request
  // and don't depend on each other, so we fan them out in parallel on every (app) page.
  let isAdmin = false;
  let showLeadership = false;
  let rpCalendarCorner: string | null = null;
  if (supabase && user) {
    const [adminResult, profileResult, simRes] = await Promise.all([
      getIsAdmin(),
      supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle(),
      supabase.from("simulation_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    isAdmin = adminResult;
    const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profileResult.data);
    showLeadership = canReviewAnyChamberLeadership(roleKeys);
    if (!simRes.error && simRes.data) {
      const effective = await resolveSimulationSettingsForWidget(
        supabase,
        simRes.data as SimulationSettingsRow,
        isAdmin,
      );
      rpCalendarCorner = formatRpCalendarShort(computeSimulationRpInstant(effective, new Date()));
    }
  }

  return (
    <div className="min-h-full bg-[var(--psc-canvas)] text-[var(--psc-ink)]">
      <header className="border-b border-[var(--psc-border)] bg-[var(--psc-panel)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">
              U.S. Federal Simulation
            </p>
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Imperium
            </Link>
          </div>
          <nav className="flex flex-wrap gap-4 text-sm font-medium">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-[var(--psc-muted)] underline-offset-4 hover:text-[var(--psc-ink)] hover:underline"
              >
                {l.label}
              </Link>
            ))}
            {showLeadership ? (
              <Link
                href="/congress/leadership"
                className="text-[var(--psc-muted)] underline-offset-4 hover:text-[var(--psc-ink)] hover:underline"
              >
                Leadership
              </Link>
            ) : null}
            {isAdmin ? (
              <Link
                href="/admin"
                className="font-semibold text-[var(--psc-seal)] underline-offset-4 hover:underline"
              >
                Admin
              </Link>
            ) : null}
          </nav>
          <div className="flex items-center gap-3 text-sm text-[var(--psc-muted)]">
            {user ? (
              <>
                <span className="font-mono text-xs">Session active</span>
                <SignOut />
              </>
            ) : (
              <Link
                href="/login"
                className="font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
      {rpCalendarCorner ? (
        <div
          className="fixed bottom-4 right-4 z-[100] rounded-md border border-[var(--psc-border)] bg-[var(--psc-panel)]/95 px-3 py-2 text-right shadow-md backdrop-blur-sm"
          title="Simulation calendar date (admins: align anchors under Admin → Elections if this looks wrong)"
        >
          <p className="font-mono text-sm font-semibold tabular-nums tracking-tight text-[var(--psc-ink)]">
            {rpCalendarCorner}
          </p>
        </div>
      ) : null}
    </div>
  );
}
