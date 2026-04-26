import Link from "next/link";
import { Suspense } from "react";
import { AppChromeRpCorner } from "@/components/app-chrome-rp-corner";
import { SignOut } from "@/components/sign-out";
import { getStaffAccess } from "@/lib/staff-access";
import { getServerAuth } from "@/lib/supabase/server";

export async function AppChrome({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await getServerAuth();

  let partyNavHref = "/parties";
  let showStaffLink = false;
  let canPersistSimHeal = false;
  let showCabinetLink = false;

  if (supabase && user) {
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("party, office_role")
      .eq("id", user.id)
      .maybeSingle();

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
    canPersistSimHeal = staffAccess?.hasFullStaff ?? false;
    const { data: grantRows } = await supabase.from("government_role_grants").select("role_key").eq("user_id", user.id);
    const roleSet = new Set<string>([
      ...(grantRows ?? []).map((r) => String((r as { role_key?: string }).role_key ?? "")),
      String(profileRow?.office_role ?? ""),
    ]);
    showCabinetLink =
      roleSet.has("secretary_of_treasury") || roleSet.has("president") || roleSet.has("admin") || roleSet.has("staff_super");
  }

  const links = [
    { href: "/", label: "Home" },
    ...(user ? [{ href: "/inbox", label: "Inbox" } as const] : []),
    { href: "/character", label: "Character" },
    { href: "/economy", label: "Economy" },
    { href: partyNavHref, label: "Party" },
    { href: "/elections", label: "Elections" },
    { href: "/congress", label: "Congress" },
    { href: "/oval", label: "Oval Office" },
    { href: "/directory", label: "Directory" },
    { href: "/policy", label: "Policy" },
  ];

  return (
    <div className="min-h-full bg-[var(--psc-canvas)] text-[var(--psc-ink)]">
      <header className="border-b border-[var(--psc-border)] bg-[var(--psc-panel)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
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
            {user ? (
              <Link
                href="/congress/leadership"
                className="text-[var(--psc-muted)] underline-offset-4 hover:text-[var(--psc-ink)] hover:underline"
              >
                Hopper
              </Link>
            ) : null}
            {showStaffLink ? (
              <Link
                href="/admin"
                className="font-semibold text-[var(--psc-seal)] underline-offset-4 hover:underline"
              >
                Admin
              </Link>
            ) : null}
            {showCabinetLink ? (
              <Link
                href="/cabinet/treasury"
                className="font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline"
              >
                Cabinet
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
      {user ? (
        <Suspense fallback={null}>
          <AppChromeRpCorner canPersistSimHeal={canPersistSimHeal} />
        </Suspense>
      ) : null}
    </div>
  );
}
