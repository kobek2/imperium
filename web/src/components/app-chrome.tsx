import Link from "next/link";
import { MaybeBackButton } from "@/components/maybe-back-button";
import { ProfileQuickDock } from "./profile-quick-dock";
import { WorldChatDock } from "@/components/world-chat-dock";
import { SignOut } from "@/components/sign-out";
import { isProfileOnboardingComplete } from "@/lib/character-onboarding";
import { showCabinetNavForRoleKeys } from "@/lib/cabinet-hub";
import { getStaffAccess } from "@/lib/staff-access";
import { getCongressAttentionSnapshotForRequest } from "@/lib/congress-viewer-attention";
import { getServerAuth } from "@/lib/supabase/server";

export async function AppChrome({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await getServerAuth();

  let partyNavHref = "/parties";
  let showStaffLink = false;
  let showCabinetLink = false;
  let canUseAppTabs = false;
  let needsCharacterSetup = false;
  let congressAttention: Awaited<ReturnType<typeof getCongressAttentionSnapshotForRequest>> = null;

  if (supabase && user) {
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
    const { data: grantRows } = await supabase.from("government_role_grants").select("role_key").eq("user_id", user.id);
    const roleKeysList = [
      ...(grantRows ?? []).map((r) => String((r as { role_key?: string }).role_key ?? "")),
      String(profileRow?.office_role ?? ""),
    ].filter(Boolean);
    showCabinetLink = showCabinetNavForRoleKeys(roleKeysList);
  }

  if (supabase && user && canUseAppTabs) {
    congressAttention = await getCongressAttentionSnapshotForRequest(supabase, user.id);
  }

  const links = canUseAppTabs
    ? [
        { href: "/", label: "Home" },
        { href: "/character", label: "Character" },
        { href: "/economy", label: "Economy" },
        { href: partyNavHref, label: "Party" },
        { href: "/elections", label: "Elections" },
        { href: "/congress", label: "Congress" },
        { href: "/oval", label: "Oval Office" },
        { href: "/directory", label: "Directory" },
        { href: "/policy", label: "Policy" },
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
            {links.map((l) => {
              const isCongress = l.href === "/congress";
              const voteStage = congressAttention?.congressPrimaryBadge ?? 0;
              const showCongressBadge = isCongress && voteStage > 0;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-[var(--psc-muted)] underline-offset-4 hover:text-[var(--psc-ink)] hover:underline"
                >
                  {showCongressBadge ? (
                    <span className="relative inline-block pr-2.5">
                      {l.label}
                      <span
                        title="Open floor votes — cast your ballot or close the roll (leadership)"
                        aria-label={`Floor votes awaiting you: ${voteStage > 99 ? "99+" : voteStage}`}
                        className="absolute -right-0.5 -top-2 z-10 inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white shadow-sm ring-1 ring-white/90"
                      >
                        {voteStage > 99 ? "99+" : voteStage}
                      </span>
                    </span>
                  ) : (
                    l.label
                  )}
                </Link>
              );
            })}
            {canUseAppTabs && congressAttention?.isLeadership ? (
              <Link
                href="/congress/leadership"
                className="text-[var(--psc-muted)] underline-offset-4 hover:text-[var(--psc-ink)] hover:underline"
              >
                {(congressAttention?.hopperLeadershipBadge ?? 0) > 0 ? (
                  <span className="relative inline-block pr-2.5">
                    Hopper
                    <span
                      title="Filings, docket moves, scheduling, and bills in debate (before the floor roll call)"
                      aria-label={`Hopper and debate queue: ${
                        (congressAttention?.hopperLeadershipBadge ?? 0) > 99
                          ? "99+"
                          : String(congressAttention?.hopperLeadershipBadge ?? 0)
                      }`}
                      className="absolute -right-0.5 -top-2 z-10 inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white shadow-sm ring-1 ring-white/90"
                    >
                      {(congressAttention?.hopperLeadershipBadge ?? 0) > 99
                        ? "99+"
                        : congressAttention?.hopperLeadershipBadge}
                    </span>
                  </span>
                ) : (
                  "Hopper"
                )}
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
                href="/cabinet"
                className="font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline"
              >
                Cabinet
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
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 empty:hidden">
          <MaybeBackButton />
        </div>
        {children}
      </main>
      {user && canUseAppTabs ? (
        <>
          <WorldChatDock />
          <ProfileQuickDock />
        </>
      ) : null}
    </div>
  );
}
