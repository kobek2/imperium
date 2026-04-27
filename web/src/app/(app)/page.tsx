import { redirect } from "next/navigation";
import { BriefingInbox } from "@/components/briefing-inbox";
import { HomeCareerStats } from "@/components/home-career-stats";
import { fetchBriefingMoments } from "@/lib/briefing-inbox";
import { fetchHomeCareerStats } from "@/lib/home-career-stats";
import { computeSimulationRpInstant, formatRpCalendarShort, type SimulationSettingsRow } from "@/lib/simulation-calendar";
import { resolveSimulationSettingsForWidget } from "@/lib/simulation-widget-data";
import { getStaffAccess } from "@/lib/staff-access";
import { getServerAuth } from "@/lib/supabase/server";

/** Home shows this many rows; we fetch one extra to detect a fuller inbox. */
const INBOX_HOME_PREVIEW = 5;

export default async function HomePage() {
  // Redirect first-time users to the character setup screen. We do this here (not in a layout)
  // so /character itself isn't caught in a loop, and so unauthenticated visitors to / still see
  // the home stub if Supabase isn't configured.
  const { supabase, user } = await getServerAuth();
  let moments: Awaited<ReturnType<typeof fetchBriefingMoments>> = [];
  let careerStats: Awaited<ReturnType<typeof fetchHomeCareerStats>> | null = null;
  let rpDateLabel: string | null = null;
  if (supabase) {
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("party, office_role")
        .eq("id", user.id)
        .maybeSingle();
      if (!profile?.party) {
        redirect("/character");
      }
      const [m, s] = await Promise.all([
        fetchBriefingMoments(supabase, user.id, INBOX_HOME_PREVIEW + 1),
        fetchHomeCareerStats(supabase, user.id),
      ]);
      moments = m;
      careerStats = s;

      const staffAccess = await getStaffAccess(profile ? { office_role: profile.office_role ?? null } : null);
      const { data: simRow, error: simError } = await supabase.from("simulation_settings").select("*").eq("id", 1).maybeSingle();
      if (!simError && simRow) {
        const effective = await resolveSimulationSettingsForWidget(
          supabase,
          simRow as SimulationSettingsRow,
          staffAccess?.hasFullStaff ?? false,
        );
        rpDateLabel = formatRpCalendarShort(computeSimulationRpInstant(effective, new Date()));
      }
    }
  }

  const inboxPreview = moments.slice(0, INBOX_HOME_PREVIEW);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Home</h1>
        {rpDateLabel ? (
          <div
            className="inline-flex items-baseline gap-2 rounded-md border border-[var(--psc-border)] bg-[var(--psc-panel)]/95 px-3 py-2 shadow-sm"
            title="Simulation calendar date"
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Date</span>
            <span className="font-mono text-sm font-semibold tabular-nums tracking-tight text-[var(--psc-ink)]">{rpDateLabel}</span>
          </div>
        ) : null}
      </header>

      <BriefingInbox moments={inboxPreview} heading="Your inbox (latest)" viewAllHref="/inbox" viewAllLabel="Open inbox →" />

      {careerStats ? <HomeCareerStats stats={careerStats} /> : null}
    </div>
  );
}
