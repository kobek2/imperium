import Link from "next/link";
import { tryCreateClient } from "@/lib/supabase/server";
import { getStaffAccess } from "@/lib/staff-access";
import {
  computeSimulationRpInstant,
  formatRpCalendarShort,
  type SimulationSettingsRow,
} from "@/lib/simulation-calendar";
import { resolveSimulationSettingsForWidget } from "@/lib/simulation-widget-data";
import { SignOut } from "@/components/sign-out";

export async function AppChrome({ children }: { children: React.ReactNode }) {
  const supabase = await tryCreateClient();
  const user = supabase
    ? (await supabase.auth.getUser()).data.user
    : null;

  let partyNavHref = "/parties";
  if (supabase && user) {
    const { data: partyRow } = await supabase.from("profiles").select("party").eq("id", user.id).maybeSingle();
    const p = String((partyRow as { party?: string | null } | null)?.party ?? "")
      .trim()
      .toLowerCase();
    if (p === "democrat" || p === "republican") {
      partyNavHref = `/parties/${p}`;
    }
  }

  const links = [
    { href: "/", label: "Home" },
    { href: "/character", label: "Character" },
    { href: "/economy", label: "Economy" },
    { href: partyNavHref, label: "Party" },
    { href: "/elections", label: "Elections" },
    { href: "/congress", label: "Congress" },
    { href: "/oval", label: "Oval Office" },
    { href: "/directory", label: "Directory" },
  ];

  let showStaffLink = false;
  let rpCalendarCorner: string | null = null;
  if (supabase && user) {
    const [staffAccess, simRes] = await Promise.all([
      getStaffAccess(),
      supabase.from("simulation_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    showStaffLink = staffAccess?.canAccessPanel ?? false;
    if (!simRes.error && simRes.data) {
      const canPersistSimHeal = staffAccess?.hasFullStaff ?? false;
      const effective = await resolveSimulationSettingsForWidget(
        supabase,
        simRes.data as SimulationSettingsRow,
        canPersistSimHeal,
      );
      rpCalendarCorner = formatRpCalendarShort(computeSimulationRpInstant(effective, new Date()));
    }
  }

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
