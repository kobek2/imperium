import { processBillDeadlines } from "@/lib/bill-pipeline";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { getServerAuth } from "@/lib/supabase/server";
import { CongressChamberNav } from "./congress-chamber-nav";

export default async function CongressLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await getServerAuth();
  let appropriationsNotice: { deadlineAt: string | null; enrolled: boolean; shutdown: boolean } | null = null;
  if (supabase) {
    await Promise.all([
      processBillDeadlines(supabase),
      runElectionPhaseSchedule(supabase),
      supabase.rpc("fiscal_start_appropriation_clock_if_president_seated"),
    ]);
    const { data: fy } = await supabase
      .from("rp_fiscal_years")
      .select("appropriation_deadline_at, appropriations_act_bill_id")
      .eq("status", "active")
      .maybeSingle();
    if (fy) {
      const deadlineAt = (fy as { appropriation_deadline_at?: string | null }).appropriation_deadline_at ?? null;
      const enrolled = Boolean((fy as { appropriations_act_bill_id?: string | null }).appropriations_act_bill_id);
      appropriationsNotice = {
        deadlineAt,
        enrolled,
        shutdown: Boolean(deadlineAt && !enrolled && new Date(deadlineAt) < new Date()),
      };
    }
  }

  const showHopper = Boolean(user);

  return (
    <div className="space-y-8">
      {appropriationsNotice?.deadlineAt && !appropriationsNotice.enrolled ? (
        <div
          className={`rounded border p-3 text-sm ${
            appropriationsNotice.shutdown ? "border-rose-600 bg-rose-50 text-rose-950" : "border-amber-600 bg-amber-50 text-amber-950"
          }`}
        >
          <p className="font-semibold">
            {appropriationsNotice.shutdown ? "Government shutdown in effect" : "Appropriations deadline active"}
          </p>
          <p className="mt-1">
            Congress must enroll the annual appropriations act by{" "}
            <span className="font-mono font-semibold">{new Date(appropriationsNotice.deadlineAt).toLocaleString()}</span>.
          </p>
        </div>
      ) : null}
      <CongressChamberNav showHopper={showHopper} />
      {children}
    </div>
  );
}
