import Link from "next/link";
import { redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import { requireStaffPageAny } from "@/lib/staff-access";
import { AdminMembersTable, type AdminMemberRow } from "./members-table";

export default async function AdminMembersPage() {
  await requireStaffPageAny(["accounts", "roles"]);

  const supabase = await tryCreateClient();
  if (!supabase) redirect("/");

  const [{ data: profiles }, { data: grants }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, character_name, discord_username, discord_user_id, office_role, party, residence_state, home_district_code, created_at",
      )
      .order("character_name", { ascending: true, nullsFirst: false }),
    supabase.from("government_role_grants").select("user_id, role_key"),
  ]);

  const byUser = new Map<string, string[]>();
  for (const g of grants ?? []) {
    const uid = g.user_id as string;
    const key = g.role_key as string;
    const arr = byUser.get(uid) ?? [];
    arr.push(key);
    byUser.set(uid, arr);
  }
  for (const [, arr] of byUser) {
    arr.sort((a, b) => a.localeCompare(b));
  }

  const rows: AdminMemberRow[] = (profiles ?? []).map((p) => ({
    id: p.id as string,
    character_name: p.character_name as string | null,
    discord_username: p.discord_username as string | null,
    discord_user_id: p.discord_user_id as string | null,
    office_role: p.office_role as string | null,
    party: p.party as string | null,
    residence_state: p.residence_state as string | null,
    home_district_code: p.home_district_code as string | null,
    created_at: (p.created_at as string) ?? new Date().toISOString(),
    grant_roles: byUser.get(p.id as string) ?? [],
  }));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
          Directory
        </p>
        <h2 className="text-xl font-semibold text-[var(--psc-ink)]">Member database</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--psc-muted)]">
          Every player profile in the sim (same rows as the public directory data source). Use search
          to filter.{" "}
          <strong className="text-[var(--psc-ink)]">Role grants</strong> come from{" "}
          <code className="font-mono text-xs">government_role_grants</code>;{" "}
          <strong className="text-[var(--psc-ink)]">Legacy role</strong> is{" "}
          <code className="font-mono text-xs">profiles.office_role</code> when set.
        </p>
      </div>

      {!rows.length ? (
        <section className="border border-dashed border-[var(--psc-border)] bg-[var(--psc-panel)] p-8 text-center text-sm text-[var(--psc-muted)]">
          No profiles yet. Players appear here after they sign in and complete onboarding.
        </section>
      ) : (
        <AdminMembersTable rows={rows} />
      )}

      <p className="text-xs text-[var(--psc-muted)]">
        Public role hierarchy:{" "}
        <Link href="/directory" className="font-semibold text-[var(--psc-accent)] underline">
          Directory
        </Link>
      </p>
    </div>
  );
}
