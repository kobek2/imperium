import { redirect } from "next/navigation";
import { MayorOfficePanel } from "@/components/mayor-office-panel";
import { OrientationTourPanelCityHall } from "@/components/orientation-tour-panel";
import { getIsAdmin } from "@/lib/is-admin";
import { loadCityFiscalSnapshot } from "@/lib/city-fiscal-data";
import { ensureCityMetricsCaughtUp } from "@/lib/city-metrics-data";
import { loadCityOfficeData } from "@/lib/city-office-data";
import { createClient } from "@/lib/supabase/server";
import { loadCitySimWeekStatus } from "@/lib/city-sim-week-data";

export default async function MayorOfficePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/welcome");

  const fiscal = await loadCityFiscalSnapshot(supabase);
  const [{ data: profile }, data, metrics, isAdmin, simWeek] = await Promise.all([
    supabase
      .from("profiles")
      .select("orientation_completed_at, orientation_step")
      .eq("id", user.id)
      .maybeSingle(),
    loadCityOfficeData(supabase, user.id),
    ensureCityMetricsCaughtUp(supabase, undefined, fiscal),
    getIsAdmin(),
    loadCitySimWeekStatus(supabase),
  ]);

  const inTour = !profile?.orientation_completed_at;
  const onStep3 = inTour && (profile?.orientation_step ?? 1) === 3;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      {onStep3 ? <OrientationTourPanelCityHall /> : null}
      <MayorOfficePanel
        data={data}
        fiscal={fiscal}
        metrics={metrics}
        simWeek={simWeek}
        isAdmin={isAdmin}
      />
    </div>
  );
}
