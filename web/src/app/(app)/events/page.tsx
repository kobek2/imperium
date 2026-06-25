import { redirect } from "next/navigation";
import { CrisisBriefingPanel } from "@/components/crisis-briefing-panel";
import { NewsroomFeed, NewsroomTicker } from "@/components/newsroom-feed";
import { fetchCrisisBriefings, fetchWireFeed, groupWireIntoArcs } from "@/lib/simulation-events";
import { canFileLegislationInChamber } from "@/lib/legislative-eligibility";
import { canActAsPresident, mergeRoleKeys } from "@/lib/role-capabilities";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getStaffMayAccessElectionsConsole } from "@/lib/staff-access";
import { getServerAuth } from "@/lib/supabase/server";

export default async function EventsPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/imperium");

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role, presidential_signature")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const mergedRoleKeys = mergeRoleKeys(roleKeys, profile?.office_role);
  const filingChamber = canFileLegislationInChamber(mergedRoleKeys, "senate") ? "senate" : "house";
  const mayActAsPresident = canActAsPresident(mergedRoleKeys);

  const [feed, briefings, canAdminDelete] = await Promise.all([
    fetchWireFeed(supabase),
    fetchCrisisBriefings(supabase, user.id, {
      presidentialSignature: profile?.presidential_signature ?? null,
      roleKeys: mergedRoleKeys,
    }),
    getStaffMayAccessElectionsConsole(),
  ]);

  const arcs = groupWireIntoArcs(feed);
  const liveCount = arcs.filter((a) => a.isActive).length;

  return (
    <div className="space-y-6">
      {briefings.length > 0 ? (
        <section className="space-y-3 rounded-lg border-2 border-red-400 bg-red-50/50 p-4 shadow-sm ring-1 ring-red-200">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-red-800">
            Your crisis briefings — respond here
          </h2>
          <p className="text-xs text-red-900/80">
            Write your own executive order or statement below. The wire will publish a follow-up article reacting to what you wrote.
          </p>
          <CrisisBriefingPanel briefings={briefings} filingChamber={filingChamber} />
        </section>
      ) : liveCount > 0 && mayActAsPresident ? (
        <section className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Live crisis on the wire — briefing failed to load</p>
          <p className="mt-1 text-xs">
            Hard-refresh this page (Cmd+Shift+R). If this persists, restart <code className="font-mono">npm run dev</code>.
          </p>
        </section>
      ) : null}

      <header className="space-y-3 border-b border-[var(--psc-border)] pb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-700">Imperium Newsroom</p>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Breaking &amp; developing</h1>
          </div>
          <p className="text-xs font-semibold text-red-800">
            {liveCount} live {liveCount === 1 ? "story" : "stories"}
          </p>
        </div>
        <p className="max-w-2xl text-sm text-[var(--psc-muted)]">
          Crises spawn automatically on the wire. Respond with real executive orders, statements, and legislation —
          you write the text; the simulation follows the paper trail. Copy any article for Discord RP.
        </p>
      </header>

      <NewsroomTicker arcs={arcs} />

      <NewsroomFeed items={feed} canAdminDelete={canAdminDelete} />
    </div>
  );
}
