import { redirect } from "next/navigation";
import { BriefingInbox } from "@/components/briefing-inbox";
import { HomeCareerStats } from "@/components/home-career-stats";
import { fetchBriefingMoments } from "@/lib/briefing-inbox";
import { fetchHomeCareerStats } from "@/lib/home-career-stats";
import { getServerAuth } from "@/lib/supabase/server";

export default async function HomePage() {
  // Redirect first-time users to the character setup screen. We do this here (not in a layout)
  // so /character itself isn't caught in a loop, and so unauthenticated visitors to / still see
  // the home stub if Supabase isn't configured.
  const { supabase, user } = await getServerAuth();
  let moments: Awaited<ReturnType<typeof fetchBriefingMoments>> = [];
  let careerStats: Awaited<ReturnType<typeof fetchHomeCareerStats>> | null = null;
  if (supabase) {
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("party")
        .eq("id", user.id)
        .maybeSingle();
      if (!profile?.party) {
        redirect("/character");
      }
      const pt = String(profile.party).trim().toLowerCase();
      if (pt === "democrat" || pt === "republican") {
        redirect(`/parties/${pt}`);
      }
      const [m, s] = await Promise.all([
        fetchBriefingMoments(supabase, user.id),
        fetchHomeCareerStats(supabase, user.id),
      ]);
      moments = m;
      careerStats = s;
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Home</h1>
      </header>

      <BriefingInbox moments={moments} />

      {careerStats ? <HomeCareerStats stats={careerStats} /> : null}
    </div>
  );
}
