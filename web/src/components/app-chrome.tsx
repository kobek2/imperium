import Link from "next/link";
import { MaybeBackButton } from "@/components/maybe-back-button";
import { ProfileQuickDock } from "./profile-quick-dock";
import { SignOut } from "@/components/sign-out";
import { isProfileOnboardingComplete } from "@/lib/character-onboarding";
import { runBackgroundSimTicks } from "@/lib/city-sim-week-data";
import { getStaffAccess } from "@/lib/staff-access";
import { getServerAuth } from "@/lib/supabase/server";

export async function AppChrome({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await getServerAuth();

  let partyNavHref = "/parties";
  let showStaffLink = false;
  let canUseAppTabs = false;
  let needsCharacterSetup = false;

  if (supabase && user) {
    await runBackgroundSimTicks(supabase);

    const { data: profileRow } = await supabase
      .from("profiles")
      .select("character_name, date_of_birth, residence_state, home_district_code, party, office_role")
      .eq("id", user.id)
      .maybeSingle();
    const complete = isProfileOnboardingComplete(profileRow);
    canUseAppTabs = complete;
    needsCharacterSetup = !complete;

    const p = String(profileRow?.party ?? "")
      .trim()
      .toLowerCase();
    if (p === "democrat" || p === "republican") {
      partyNavHref = `/parties/${p}`;
    }

    const staffAccess = await getStaffAccess(
      profileRow ? { office_role: profileRow.office_role ?? null } : null,
    );
    showStaffLink = staffAccess?.canAccessPanel ?? false;
  }

  const links = canUseAppTabs
    ? [
        { href: "/", label: "Home" },
        { href: "/character", label: "Character" },
        { href: "/economy", label: "Economy" },
        { href: partyNavHref, label: "Party" },
        { href: "/elections", label: "Elections" },
        { href: "/mayor", label: "Mayor's Office" },
        { href: "/council", label: "City Council" },
        { href: "/directory", label: "Directory" },
      ]
    : [{ href: "/imperium", label: "Imperium" }];

  return (
    <div className="min-h-full bg-[var(--psc-canvas)] text-[var(--psc-ink)]">
      <header className="border-b border-[var(--psc-border)] bg-[var(--psc-panel)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <Link href="/imperium" className="text-lg font-semibold tracking-tight">
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
            {showStaffLink ? (
              <Link
                href="/admin"
                className="font-semibold text-[var(--psc-seal)] underline-offset-4 hover:underline"
              >
                Admin
              </Link>
            ) : null}
            {needsCharacterSetup ? (
              <Link
                href="/onboarding"
                className="font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline"
              >
                Create character
              </Link>
            ) : null}
          </nav>
          {!user || needsCharacterSetup ? (
            <div className="flex shrink-0 items-center gap-3 text-sm">
              {!user ? (
                <Link
                  href="/login"
                  className="font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline"
                >
                  Sign in
                </Link>
              ) : (
                <SignOut />
              )}
            </div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 empty:hidden">
          <MaybeBackButton />
        </div>
        {children}
      </main>
      {user && canUseAppTabs ? <ProfileQuickDock /> : null}
    </div>
  );
}
