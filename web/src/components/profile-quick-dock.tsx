import Link from "next/link";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { formatPrimaryGovernmentTitle } from "@/lib/government-role-display";
import { getServerAuth } from "@/lib/supabase/server";

function usd(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export async function ProfileQuickDock() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) return null;

  const [{ data: profile }, { data: wallet }] = await Promise.all([
    supabase
      .from("profiles")
      .select("character_name, discord_username, office_role, approval_rating")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("economy_wallets").select("balance").eq("user_id", user.id).maybeSingle(),
  ]);

  if (!profile) return null;
  const displayName = String(profile.character_name ?? profile.discord_username ?? "Member").trim() || "Member";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "M";
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const title = formatPrimaryGovernmentTitle(roleKeys);
  const balance = Number((wallet as { balance?: number } | null)?.balance ?? 0);
  const approval = Math.max(0, Math.min(100, Math.round(Number((profile as { approval_rating?: number }).approval_rating ?? 50))));

  return (
    <details className="fixed bottom-4 right-4 z-[100]">
      <summary
        className="flex h-12 w-12 cursor-pointer list-none items-center justify-center rounded-full border border-[var(--psc-border)] bg-[var(--psc-panel)] text-sm font-bold text-[var(--psc-ink)] shadow-md backdrop-blur-sm [&::-webkit-details-marker]:hidden"
        title={`${displayName} · ${approval}% approval · open quick menu`}
      >
        {initials}
      </summary>
      <div className="absolute bottom-14 right-0 w-72 rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Character</p>
        <p className="mt-1 text-lg font-semibold text-[var(--psc-ink)]">{displayName}</p>
        <p className="text-sm text-[var(--psc-muted)]">{title}</p>

        <div className="mt-4 space-y-2 rounded border border-[var(--psc-border)] bg-white p-3">
          <p className="text-xs text-[var(--psc-muted)]">Balance</p>
          <p className="font-mono text-xl font-semibold text-[var(--psc-ink)]">{usd(balance)}</p>
          <div className="mt-2">
            <p className="text-xs text-[var(--psc-muted)]">Political approval</p>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--psc-border)]">
                <div className="h-full rounded-full bg-[var(--psc-accent)]" style={{ width: `${approval}%` }} />
              </div>
              <span className="font-mono text-sm font-semibold tabular-nums text-[var(--psc-ink)]">{approval}</span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          <Link href="/character" className="rounded border border-[var(--psc-border)] bg-white px-2 py-1 text-[var(--psc-ink)]">
            Profile
          </Link>
          <Link href="/economy" className="rounded border border-[var(--psc-border)] bg-white px-2 py-1 text-[var(--psc-ink)]">
            Economy
          </Link>
          <Link href="/leaderboard" className="rounded border border-[var(--psc-border)] bg-white px-2 py-1 text-[var(--psc-ink)]">
            Leaderboard
          </Link>
        </div>
      </div>
    </details>
  );
}
