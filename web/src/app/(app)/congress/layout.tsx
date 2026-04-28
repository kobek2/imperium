import Link from "next/link";
import { processBillDeadlines } from "@/lib/bill-pipeline";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { getServerAuth } from "@/lib/supabase/server";
import { CongressChamberNav } from "./congress-chamber-nav";
import { billStatusDisplay } from "@/lib/bill-display-status";

export default async function CongressLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await getServerAuth();
  let appropriationsNotice: { deadlineAt: string | null; enrolled: boolean; shutdown: boolean } | null = null;
  let appropriationsTracker: { id: string; title: string; status: string } | null = null;
  if (supabase) {
    await Promise.all([
      processBillDeadlines(supabase),
      runElectionPhaseSchedule(supabase),
      supabase.rpc("fiscal_start_appropriation_clock_if_president_seated"),
    ]);
    const { data: fy } = await supabase
      .from("rp_fiscal_years")
      .select("id, appropriation_deadline_at, appropriations_act_bill_id")
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

      const linkedFiscalYearId = String((fy as { id?: string }).id ?? "");
      const enrolledBillId = (fy as { appropriations_act_bill_id?: string | null }).appropriations_act_bill_id ?? null;
      if (enrolledBillId) {
        const { data: enrolledBill } = await supabase
          .from("bills")
          .select("id, title, status")
          .eq("id", enrolledBillId)
          .maybeSingle();
        if (enrolledBill) {
          appropriationsTracker = enrolledBill as { id: string; title: string; status: string };
        }
      } else if (linkedFiscalYearId) {
        const { data: latestAppBill } = await supabase
          .from("bills")
          .select("id, title, status")
          .eq("linked_fiscal_year_id", linkedFiscalYearId)
          .eq("is_federal_appropriations", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestAppBill) {
          appropriationsTracker = latestAppBill as { id: string; title: string; status: string };
        }
      }
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
      {appropriationsTracker ? (
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-3 text-sm">
          <p className="font-semibold text-[var(--psc-ink)]">FY appropriations bill tracker</p>
          <p className="mt-1 text-[var(--psc-muted)]">
            <Link href={`/bill/${appropriationsTracker.id}`} className="font-semibold text-[var(--psc-accent)] underline">
              {appropriationsTracker.title}
            </Link>{" "}
            · {billStatusDisplay(appropriationsTracker.status)}
          </p>
        </div>
      ) : null}
      <CongressChamberNav showHopper={showHopper} />
      {children}
    </div>
  );
}
