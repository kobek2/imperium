import Link from "next/link";
import { processBillDeadlines } from "@/lib/bill-pipeline";
import { runElectionPhaseSchedule } from "@/lib/election-phase-schedule";
import { AppropriationsCountdownBar } from "@/components/appropriations-countdown-bar";
import { getServerAuth } from "@/lib/supabase/server";
import { CongressChamberNav } from "./congress-chamber-nav";
import { billStatusDisplay } from "@/lib/bill-display-status";

export default async function CongressLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await getServerAuth();
  let appropriationsNotice: { deadlineAt: string | null; enrolled: boolean; economyFrozen: boolean } | null = null;
  let appropriationsTracker: { id: string; title: string; status: string } | null = null;
  if (supabase) {
    await Promise.all([processBillDeadlines(supabase), runElectionPhaseSchedule(supabase)]);
    const { data: fy } = await supabase
      .from("rp_fiscal_years")
      .select("id, appropriation_deadline_at, appropriations_act_bill_id, economy_activity_frozen")
      .eq("status", "active")
      .maybeSingle();
    if (fy) {
      const deadlineAt = (fy as { appropriation_deadline_at?: string | null }).appropriation_deadline_at ?? null;
      const enrolled = Boolean((fy as { appropriations_act_bill_id?: string | null }).appropriations_act_bill_id);
      appropriationsNotice = {
        deadlineAt,
        enrolled,
        economyFrozen: Boolean((fy as { economy_activity_frozen?: boolean | null }).economy_activity_frozen),
      };

      const linkedFiscalYearId = String((fy as { id?: string }).id ?? "");
      const enrolledBillId = (fy as { appropriations_act_bill_id?: string | null }).appropriations_act_bill_id ?? null;
      if (enrolledBillId) {
        const { data: enrolledBill, error: enrolledErr } = await supabase
          .from("bills")
          .select("id, title, status")
          .eq("id", enrolledBillId)
          .maybeSingle();
        if (!enrolledErr && enrolledBill) {
          appropriationsTracker = enrolledBill as { id: string; title: string; status: string };
        }
      } else if (linkedFiscalYearId) {
        const { data: latestAppBill, error: appErr } = await supabase
          .from("bills")
          .select("id, title, status")
          .eq("linked_fiscal_year_id", linkedFiscalYearId)
          .eq("is_federal_appropriations", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!appErr && latestAppBill) {
          appropriationsTracker = latestAppBill as { id: string; title: string; status: string };
        }
      }
    }
  }

  const showHopper = Boolean(user);

  return (
    <div className="space-y-8">
      {appropriationsNotice && !appropriationsNotice.enrolled ? (
        <AppropriationsCountdownBar
          deadlineAt={appropriationsNotice.deadlineAt}
          enrolled={appropriationsNotice.enrolled}
          economyFrozen={appropriationsNotice.economyFrozen}
        />
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
