import { redirect } from "next/navigation";
import { NewsroomFeed, NewsroomTicker } from "@/components/newsroom-feed";
import { SimulationEventsPanel } from "@/components/simulation-events-panel";
import { fetchUserSimulationEvents, fetchWireFeed, groupWireIntoArcs } from "@/lib/simulation-events";
import { getStaffMayAccessElectionsConsole } from "@/lib/staff-access";
import { getServerAuth } from "@/lib/supabase/server";

export default async function EventsPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/imperium");

  const [feed, myEvents, canAdminDelete] = await Promise.all([
    fetchWireFeed(supabase),
    fetchUserSimulationEvents(supabase, user.id),
    getStaffMayAccessElectionsConsole(),
  ]);

  const arcs = groupWireIntoArcs(feed);
  const liveCount = arcs.filter((a) => a.isActive).length;

  return (
    <div className="space-y-6">
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
          Full wire coverage — context, quotes, and developing timelines on immigration, healthcare, conflict,
          and more. Copy any article for Discord. Stories build across multiple updates.
        </p>
      </header>

      <NewsroomTicker arcs={arcs} />

      <NewsroomFeed items={feed} canAdminDelete={canAdminDelete} />

      {myEvents.length > 0 ? (
        <section className="space-y-3 rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--psc-muted)]">
            Your action items
          </h2>
          <SimulationEventsPanel events={myEvents} />
        </section>
      ) : null}
    </div>
  );
}
