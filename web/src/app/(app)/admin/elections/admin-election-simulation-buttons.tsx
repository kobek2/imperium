import Link from "next/link";
import { NYC_CITY_NAME } from "@/lib/city";
import { AdminCitySimWeekControls } from "@/components/admin-city-sim-week-controls";
import { loadCitySimWeekStatus } from "@/lib/city-sim-week-data";
import { getStaffAccess } from "@/lib/staff-access";
import { createClient } from "@/lib/supabase/server";

export async function AdminElectionSimulationButtons() {
  const supabase = await createClient();
  const [simWeek, staffAccess] = await Promise.all([loadCitySimWeekStatus(supabase), getStaffAccess()]);
  const canDev = Boolean(staffAccess?.hasFullStaff);

  return (
    <div className="space-y-4">
      <AdminCitySimWeekControls status={simWeek} canDev={canDev} />
      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">City elections</h3>
        <p className="mt-1 text-[11px] text-[var(--psc-muted)]">
          {NYC_CITY_NAME} races use the dev panel above to open templates and advance phases.
          NPC incumbents only file when nobody else does. Per-race overrides remain on each election
          detail page. Create dormant templates from{" "}
          <Link href="/admin/elections/new" className="font-semibold text-[var(--psc-accent)] underline underline-offset-2">
            Admin → Create election
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
